// Test module for signer_token_policy. No pub definitions → qualifies
// as a test module, which allows importing validators directly.
use aiken/cbor.{serialise}
use aiken/collection/dict
use aiken/crypto.{sha3_256}
use aiken/fuzz
use aiken/interval.{Interval, IntervalBound, NegativeInfinity, PositiveInfinity}
use aiken/primitive/bytearray
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{Value}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use config.{protocol_parameters_script_hash}
use consts.{protocol_parameters_token}
use signer_token_policy.{
  SignerTokenPolicyRedeemer, is_signer_metadatum_correct,
}
use types.{ProtocolParametersDatum, SignerMetadataDatum}

// ── is_signer_metadatum_correct: unit tests ──────────────

test metadatum_valid_nick_name_only() {
  is_signer_metadatum_correct(
    SignerMetadataDatum {
      nick_name: #"616c696365",
      real_name: #"",
      contact_info: #"",
      additional_info: #"",
    },
  )
}

test metadatum_valid_all_fields_set() {
  is_signer_metadatum_correct(
    SignerMetadataDatum {
      nick_name: #"616c696365",
      real_name: #"416c69636520536d697468",
      contact_info: #"616c696365406578616d706c652e636f6d",
      additional_info: #"43617264616e6f206465766c6f706572",
    },
  )
}

test metadatum_fails_empty_nick_name() fail {
  is_signer_metadatum_correct(
    SignerMetadataDatum {
      nick_name: #"",
      real_name: #"416c69636520536d697468",
      contact_info: #"616c696365406578616d706c652e636f6d",
      additional_info: #"",
    },
  )
}

test metadatum_fails_all_fields_empty() fail {
  is_signer_metadatum_correct(
    SignerMetadataDatum {
      nick_name: #"",
      real_name: #"",
      contact_info: #"",
      additional_info: #"",
    },
  )
}

// ── is_signer_metadatum_correct: property tests ──────────

test prop_metadatum_valid_for_any_non_empty_nick_name(
  nick_name via fuzz.bytearray_between(1, 32),
) {
  is_signer_metadatum_correct(
    SignerMetadataDatum {
      nick_name,
      real_name: #"",
      contact_info: #"",
      additional_info: #"",
    },
  )
}

test prop_metadatum_invalid_with_empty_nick_name(
  (real_name, contact_info) via fuzz.both(fuzz.bytearray(), fuzz.bytearray()),
) {
  // Even with all other fields populated, empty nick_name is always rejected.
  !is_signer_metadatum_correct(
    SignerMetadataDatum {
      nick_name: #"",
      real_name,
      contact_info,
      additional_info: #"",
    },
  )
}

// ── Mock constants ────────────────────────────────────────

// 28 bytes = 56 hex chars
const mock_signer_policy: ByteArray =
  #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

const mock_sm_validator: ByteArray =
  #"d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4"

// The signer's wallet payment-key hash — the second minted signer
// token must land at a VerificationKey address, not a script.
const mock_signer_wallet: ByteArray =
  #"f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6"

// 32 bytes = 64 hex chars
const mock_tx_id: ByteArray =
  #"0000000000000000000000000000000000000000000000000000000000000000"

// The output_reference of the UTxO the signer is spending.
const mock_signer_tx_id: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const mock_signer_ix: Int = 0

// ── Mock data builders ────────────────────────────────────

fn mock_signer_token_name() -> ByteArray {
  sha3_256(bytearray.concat(mock_signer_tx_id, serialise(mock_signer_ix)))
}

fn mock_signer_metadatum() -> SignerMetadataDatum {
  SignerMetadataDatum {
    nick_name: #"cafe",
    real_name: #"",
    contact_info: #"",
    additional_info: #"",
  }
}

fn mock_pp_datum() -> ProtocolParametersDatum {
  ProtocolParametersDatum {
    signer_token_policy: mock_signer_policy,
    signer_metadata_validator: mock_sm_validator,
    signature_token_policy: #"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3",
    attestation_validator: #"e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5",
  }
}

fn build_tx(
  inputs: List<Input>,
  reference_inputs: List<Input>,
  outputs: List<Output>,
  mint: Value,
) -> Transaction {
  Transaction {
    inputs,
    reference_inputs,
    outputs,
    fee: 0,
    mint,
    certificates: [],
    withdrawals: [],
    validity_range: Interval {
      lower_bound: IntervalBound {
        bound_type: NegativeInfinity,
        is_inclusive: True,
      },
      upper_bound: IntervalBound {
        bound_type: PositiveInfinity,
        is_inclusive: True,
      },
    },
    extra_signatories: [],
    redeemers: [],
    datums: dict.empty,
    id: mock_tx_id,
    votes: [],
    proposal_procedures: [],
    current_treasury_amount: None,
    treasury_donation: None,
  }
}

// Protocol parameters reference input.
fn pp_ref_input() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: mock_tx_id,
      output_index: 2,
    },
    output: Output {
      address: Address {
        payment_credential: Script(protocol_parameters_script_hash),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(
            protocol_parameters_script_hash,
            protocol_parameters_token,
            1,
          ),
      datum: InlineDatum(mock_pp_datum()),
      reference_script: None,
    },
  }
}

// The single UTxO the signer spends; its output_reference determines
// the derived signer token name.
fn signer_input() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: mock_signer_tx_id,
      output_index: mock_signer_ix,
    },
    output: Output {
      address: Address {
        payment_credential: Script(mock_signer_policy),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

// First output: signer metadata UTxO at the signer_metadata_validator address,
// holding 1 signer token.
fn signer_metadata_output() -> Output {
  Output {
    address: Address {
      payment_credential: Script(mock_sm_validator),
      stake_credential: None,
    },
    value: assets.from_lovelace(2_000_000)
      |> assets.add(mock_signer_policy, mock_signer_token_name(), 1),
    datum: InlineDatum(mock_signer_metadatum()),
    reference_script: None,
  }
}

// Second output: signer's own wallet, holding the other signer token.
fn signer_change_output() -> Output {
  Output {
    address: Address {
      payment_credential: VerificationKey(mock_signer_wallet),
      stake_credential: None,
    },
    value: assets.from_lovelace(2_000_000)
      |> assets.add(mock_signer_policy, mock_signer_token_name(), 1),
    datum: NoDatum,
    reference_script: None,
  }
}

// ── Mint: unit tests ──────────────────────────────────────

test mint_happy_path() {
  let tx =
    build_tx(
      [signer_input()],
      [pp_ref_input()],
      [signer_metadata_output(), signer_change_output()],
      assets.from_asset(mock_signer_policy, mock_signer_token_name(), 2),
    )
  signer_token_policy.signer_token_policy.mint(
    SignerTokenPolicyRedeemer {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      signer_metadata_output_ix: 0,
    },
    mock_signer_policy,
    tx,
  )
}

test mint_succeeds_with_multiple_inputs() {
  // Wallets with fragmented UTxOs may need additional inputs to cover
  // fees and minimum-Ada. The validator must accept that, as long as
  // signer_input_ix points at the UTxO whose output_reference seeds
  // the token name.
  let extra_input =
    Input {
      output_reference: OutputReference {
        transaction_id: mock_tx_id,
        output_index: 99,
      },
      output: Output {
        address: Address {
          payment_credential: Script(mock_signer_policy),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let tx =
    build_tx(
      [extra_input, signer_input()],
      [pp_ref_input()],
      [signer_metadata_output(), signer_change_output()],
      assets.from_asset(mock_signer_policy, mock_signer_token_name(), 2),
    )
  signer_token_policy.signer_token_policy.mint(
    SignerTokenPolicyRedeemer {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_output_ix: 0,
    },
    mock_signer_policy,
    tx,
  )
}

test mint_fails_wrong_signer_policy_in_pp() fail {
  // PP datum references a different signer_token_policy: signer_token_policy_correct fails.
  let wrong_policy =
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let wrong_pp_datum =
    ProtocolParametersDatum {
      signer_token_policy: wrong_policy,
      signer_metadata_validator: mock_sm_validator,
      signature_token_policy: #"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3",
      attestation_validator: #"e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5",
    }
  let wrong_pp_ref =
    Input {
      output_reference: OutputReference {
        transaction_id: mock_tx_id,
        output_index: 2,
      },
      output: Output {
        address: Address {
          payment_credential: Script(protocol_parameters_script_hash),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000)
          |> assets.add(
              protocol_parameters_script_hash,
              protocol_parameters_token,
              1,
            ),
        datum: InlineDatum(wrong_pp_datum),
        reference_script: None,
      },
    }
  let tx =
    build_tx(
      [signer_input()],
      [wrong_pp_ref],
      [signer_metadata_output(), signer_change_output()],
      assets.from_asset(mock_signer_policy, mock_signer_token_name(), 2),
    )
  signer_token_policy.signer_token_policy.mint(
    SignerTokenPolicyRedeemer {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      signer_metadata_output_ix: 0,
    },
    mock_signer_policy,
    tx,
  )
}

test mint_fails_wrong_token_quantity() fail {
  // Minting 1 instead of 2: mint_correct fails.
  let tx =
    build_tx(
      [signer_input()],
      [pp_ref_input()],
      [signer_metadata_output(), signer_change_output()],
      assets.from_asset(mock_signer_policy, mock_signer_token_name(), 1),
    )
  signer_token_policy.signer_token_policy.mint(
    SignerTokenPolicyRedeemer {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      signer_metadata_output_ix: 0,
    },
    mock_signer_policy,
    tx,
  )
}

test mint_fails_wrong_metadata_address() fail {
  // Signer metadata output sent to wrong address: signer_metadata_address_correct fails.
  let wrong_metadata_output =
    Output {
      address: Address {
        payment_credential: Script(mock_signer_policy),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, mock_signer_token_name(), 1),
      datum: InlineDatum(mock_signer_metadatum()),
      reference_script: None,
    }
  let tx =
    build_tx(
      [signer_input()],
      [pp_ref_input()],
      [wrong_metadata_output, signer_change_output()],
      assets.from_asset(mock_signer_policy, mock_signer_token_name(), 2),
    )
  signer_token_policy.signer_token_policy.mint(
    SignerTokenPolicyRedeemer {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      signer_metadata_output_ix: 0,
    },
    mock_signer_policy,
    tx,
  )
}

test mint_fails_empty_nick_name() fail {
  // Empty nick_name in metadata datum: signer_metadatum_correct fails.
  let bad_metadatum =
    SignerMetadataDatum {
      nick_name: #"",
      real_name: #"",
      contact_info: #"",
      additional_info: #"",
    }
  let bad_metadata_output =
    Output {
      address: Address {
        payment_credential: Script(mock_sm_validator),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, mock_signer_token_name(), 1),
      datum: InlineDatum(bad_metadatum),
      reference_script: None,
    }
  let tx =
    build_tx(
      [signer_input()],
      [pp_ref_input()],
      [bad_metadata_output, signer_change_output()],
      assets.from_asset(mock_signer_policy, mock_signer_token_name(), 2),
    )
  signer_token_policy.signer_token_policy.mint(
    SignerTokenPolicyRedeemer {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      signer_metadata_output_ix: 0,
    },
    mock_signer_policy,
    tx,
  )
}

test mint_fails_second_signer_token_at_script_address() fail {
  // The second minted signer token must land at a wallet (VerificationKey)
  // address. If it ends up at any script address (e.g. another instance of
  // signer_metadata_validator, or any unrelated script) the spend validators
  // — which require signer_input to come from a VerificationKey address —
  // would be unable to use it, permanently bricking the signer's identity.
  let script_locked_change =
    Output {
      address: Address {
        payment_credential: Script(mock_sm_validator),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, mock_signer_token_name(), 1),
      datum: NoDatum,
      reference_script: None,
    }
  let tx =
    build_tx(
      [signer_input()],
      [pp_ref_input()],
      [signer_metadata_output(), script_locked_change],
      assets.from_asset(mock_signer_policy, mock_signer_token_name(), 2),
    )
  signer_token_policy.signer_token_policy.mint(
    SignerTokenPolicyRedeemer {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      signer_metadata_output_ix: 0,
    },
    mock_signer_policy,
    tx,
  )
}

// ── Mint: property tests ──────────────────────────────────

test prop_mint_any_non_empty_nick_name(
  nick_name via fuzz.bytearray_between(1, 32),
) {
  // Any non-empty nick_name should be accepted.
  let fuzz_metadatum =
    SignerMetadataDatum {
      nick_name,
      real_name: #"",
      contact_info: #"",
      additional_info: #"",
    }
  let fuzz_metadata_output =
    Output {
      address: Address {
        payment_credential: Script(mock_sm_validator),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, mock_signer_token_name(), 1),
      datum: InlineDatum(fuzz_metadatum),
      reference_script: None,
    }
  let tx =
    build_tx(
      [signer_input()],
      [pp_ref_input()],
      [fuzz_metadata_output, signer_change_output()],
      assets.from_asset(mock_signer_policy, mock_signer_token_name(), 2),
    )
  signer_token_policy.signer_token_policy.mint(
    SignerTokenPolicyRedeemer {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      signer_metadata_output_ix: 0,
    },
    mock_signer_policy,
    tx,
  )
}

test prop_mint_any_signer_input_ref(
  (fuzz_tx_id, fuzz_ix) via fuzz.both(
    fuzz.bytearray_fixed(32),
    fuzz.int_between(0, 65535),
  ),
) {
  // The token name is derived from the signer input's output_reference;
  // the validator should accept any valid output_reference, including
  // output indices >= 256 (regression test for the truncation bug
  // when bytearray.push was used).
  let fuzz_token_name = sha3_256(bytearray.concat(fuzz_tx_id, serialise(fuzz_ix)))
  let fuzz_signer_input =
    Input {
      output_reference: OutputReference {
        transaction_id: fuzz_tx_id,
        output_index: fuzz_ix,
      },
      output: Output {
        address: Address {
          payment_credential: Script(mock_signer_policy),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let fuzz_metadata_output =
    Output {
      address: Address {
        payment_credential: Script(mock_sm_validator),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, fuzz_token_name, 1),
      datum: InlineDatum(mock_signer_metadatum()),
      reference_script: None,
    }
  let fuzz_signer_change =
    Output {
      address: Address {
        payment_credential: VerificationKey(mock_signer_wallet),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, fuzz_token_name, 1),
      datum: NoDatum,
      reference_script: None,
    }
  let tx =
    build_tx(
      [fuzz_signer_input],
      [pp_ref_input()],
      [fuzz_metadata_output, fuzz_signer_change],
      assets.from_asset(mock_signer_policy, fuzz_token_name, 2),
    )
  signer_token_policy.signer_token_policy.mint(
    SignerTokenPolicyRedeemer {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      signer_metadata_output_ix: 0,
    },
    mock_signer_policy,
    tx,
  )
}
