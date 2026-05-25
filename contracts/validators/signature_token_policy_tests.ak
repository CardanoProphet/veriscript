// Test module for signature_token_policy. No pub definitions → qualifies
// as a test module, which allows importing validators directly.
use aiken/collection/dict
use aiken/fuzz
use aiken/interval.{Interval, IntervalBound, NegativeInfinity, PositiveInfinity}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{Value}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use config.{protocol_parameters_script_hash}
use consts.{protocol_parameters_token}
use signature_token_policy
use signature_token_policy.{
  MintSignatureToken, Retire, is_attestation_datum_correct,
}
use types.{AttestationDatum, ProtocolParametersDatum}

// ── Mock constants ────────────────────────────────────────

// 28 bytes = 56 hex chars
const mock_sig_policy: ByteArray =
  #"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3"

const mock_signer_policy: ByteArray =
  #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

const mock_attestation_validator: ByteArray =
  #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

// The signer's wallet payment-key hash — distinct from any script hash
// because the signer input must come from a wallet, not a script UTxO.
const mock_signer_wallet: ByteArray =
  #"e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5"

const mock_signer_name: ByteArray = #"cafe"

// 32 bytes = 64 hex chars
const mock_tx_id: ByteArray =
  #"0000000000000000000000000000000000000000000000000000000000000000"

// ── Mock data builders ────────────────────────────────────

fn mock_attestation_datum() -> AttestationDatum {
  AttestationDatum {
    original_author: mock_signer_name,
    description: #"deadbeef",
    source_code: #"cafebabe",
    script_hash: #"abcd1234",
    script_address: #"babe",
    staking_policy: #"",
    minting_policy: #"",
    counter_attestation: False,
  }
}

fn mock_pp_datum() -> ProtocolParametersDatum {
  ProtocolParametersDatum {
    signer_token_policy: mock_signer_policy,
    signer_metadata_validator: #"d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4",
    signature_token_policy: mock_sig_policy,
    attestation_validator: mock_attestation_validator,
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
        |> assets.add(protocol_parameters_script_hash, protocol_parameters_token, 1),
      datum: InlineDatum(mock_pp_datum()),
      reference_script: None,
    },
  }
}

// Signer's input for new-attestation (signer_input_ix_option = -1).
// Must carry exactly one signer token and must come from the signer's
// wallet (a VerificationKey address), not from any script UTxO.
fn signer_input() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: mock_tx_id,
      output_index: 0,
    },
    output: Output {
      address: Address {
        payment_credential: VerificationKey(mock_signer_wallet),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, mock_signer_name, 1),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

// Unsigned attestation input (used for additional-signature case).
fn attest_input_unsigned() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: mock_tx_id,
      output_index: 0,
    },
    output: Output {
      address: Address {
        payment_credential: Script(mock_attestation_validator),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000),
      datum: InlineDatum(mock_attestation_datum()),
      reference_script: None,
    },
  }
}

// First output: attestation UTxO at the attestation_validator address,
// holding the new signature token.
fn attestation_output() -> Output {
  Output {
    address: Address {
      payment_credential: Script(mock_attestation_validator),
      stake_credential: None,
    },
    value: assets.from_lovelace(2_000_000)
      |> assets.add(mock_sig_policy, mock_signer_name, 1),
    datum: InlineDatum(mock_attestation_datum()),
    reference_script: None,
  }
}

// Second output: signer's change (contents not checked by validator).
fn signer_change_output() -> Output {
  Output {
    address: Address {
      payment_credential: Script(mock_signer_policy),
      stake_credential: None,
    },
    value: assets.from_lovelace(2_000_000),
    datum: NoDatum,
    reference_script: None,
  }
}

// ── MintSignatureToken (new attestation): unit tests ─────

test mint_new_attestation_happy_path() {
  // signer_input_ix_option = -1: exactly one input, new attestation datum checked.
  let tx =
    build_tx(
      [signer_input()],
      [pp_ref_input()],
      [attestation_output(), signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  signature_token_policy.signature_token_policy.mint(
    MintSignatureToken {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      attestation_output_ix: 0,
      is_new_attestation: True,
    },
    mock_sig_policy,
    tx,
  )
}

test mint_new_attestation_succeeds_with_extra_inputs() {
  // Wallets with fragmented UTxOs may add extra inputs for fees/min-Ada.
  // The validator must accept that as long as signer_input_ix is correct.
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
      [attestation_output(), signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  signature_token_policy.signature_token_policy.mint(
    MintSignatureToken {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      attestation_output_ix: 0,
      is_new_attestation: True,
    },
    mock_sig_policy,
    tx,
  )
}

test mint_signature_fails_when_signer_input_is_attestation_utxo() fail {
  // Sanity: someone trying to derive the signer token name from a UTxO
  // locked at the attestation_validator address must be rejected.
  let tx =
    build_tx(
      [attest_input_unsigned(), signer_input()],
      [pp_ref_input()],
      [attestation_output(), signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  signature_token_policy.signature_token_policy.mint(
    MintSignatureToken {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      attestation_output_ix: 0,
      is_new_attestation: False,
    },
    mock_sig_policy,
    tx,
  )
}

test mint_signature_fails_when_signer_input_at_script_address() fail {
  // The signer input must be a wallet (VerificationKey) UTxO. The
  // restriction is general — any script address must be rejected, not
  // just the attestation_validator. Here we point signer_input_ix at a
  // UTxO locked at the signer_metadata_validator that happens to hold
  // the signer token.
  let script_locked_signer =
    Input {
      output_reference: OutputReference {
        transaction_id: mock_tx_id,
        output_index: 0,
      },
      output: Output {
        address: Address {
          payment_credential: Script(
            #"d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4",
          ),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000)
          |> assets.add(mock_signer_policy, mock_signer_name, 1),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let tx =
    build_tx(
      [script_locked_signer],
      [pp_ref_input()],
      [attestation_output(), signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  signature_token_policy.signature_token_policy.mint(
    MintSignatureToken {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      attestation_output_ix: 0,
      is_new_attestation: True,
    },
    mock_sig_policy,
    tx,
  )
}

test mint_new_attestation_fails_wrong_sig_policy_in_pp() fail {
  // PP datum references a different signature_token_policy:
  // signature_token_policy_correct fails.
  let wrong_policy =
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let wrong_pp_datum =
    ProtocolParametersDatum {
      signer_token_policy: mock_signer_policy,
      signer_metadata_validator: #"d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4",
      signature_token_policy: wrong_policy,
      attestation_validator: mock_attestation_validator,
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
      [attestation_output(), signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  signature_token_policy.signature_token_policy.mint(
    MintSignatureToken {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      attestation_output_ix: 0,
      is_new_attestation: True,
    },
    mock_sig_policy,
    tx,
  )
}

test mint_new_attestation_fails_wrong_token_quantity() fail {
  // Minting 2 instead of 1: mint_correct fails.
  let tx =
    build_tx(
      [signer_input()],
      [pp_ref_input()],
      [attestation_output(), signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 2),
    )
  signature_token_policy.signature_token_policy.mint(
    MintSignatureToken {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      attestation_output_ix: 0,
      is_new_attestation: True,
    },
    mock_sig_policy,
    tx,
  )
}

test mint_new_attestation_fails_wrong_attestation_address() fail {
  // Attestation output not at Script(attestation_validator):
  // attestation_address_correct fails.
  let wrong_output =
    Output {
      address: Address {
        payment_credential: Script(mock_signer_policy),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_sig_policy, mock_signer_name, 1),
      datum: InlineDatum(mock_attestation_datum()),
      reference_script: None,
    }
  let tx =
    build_tx(
      [signer_input()],
      [pp_ref_input()],
      [wrong_output, signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  signature_token_policy.signature_token_policy.mint(
    MintSignatureToken {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      attestation_output_ix: 0,
      is_new_attestation: True,
    },
    mock_sig_policy,
    tx,
  )
}

test mint_new_attestation_fails_bad_datum() fail {
  // Empty description in attestation datum: attestation_datum_correct fails.
  let bad_datum =
    AttestationDatum {
      original_author: mock_signer_name,
      description: #"",
      source_code: #"cafebabe",
      script_hash: #"abcd1234",
      script_address: #"babe",
      staking_policy: #"",
      minting_policy: #"",
      counter_attestation: False,
    }
  let bad_output =
    Output {
      address: Address {
        payment_credential: Script(mock_attestation_validator),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_sig_policy, mock_signer_name, 1),
      datum: InlineDatum(bad_datum),
      reference_script: None,
    }
  let tx =
    build_tx(
      [signer_input()],
      [pp_ref_input()],
      [bad_output, signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  signature_token_policy.signature_token_policy.mint(
    MintSignatureToken {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      attestation_output_ix: 0,
      is_new_attestation: True,
    },
    mock_sig_policy,
    tx,
  )
}

// ── MintSignatureToken (additional signer): unit tests ────

test mint_additional_signature_happy_path() {
  // signer_input_ix_option = 1: signer is inputs[1], datum check skipped.
  // attest_input_unsigned (at the attestation_validator address) satisfies
  // the "existing attestation is being spent" requirement.
  let tx =
    build_tx(
      [attest_input_unsigned(), signer_input()],
      [pp_ref_input()],
      [attestation_output(), signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  signature_token_policy.signature_token_policy.mint(
    MintSignatureToken {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      attestation_output_ix: 0,
      is_new_attestation: False,
    },
    mock_sig_policy,
    tx,
  )
}

test mint_additional_signature_fails_without_attestation_input() fail {
  // is_new_attestation: False is reserved for the "additional signer joins
  // an existing attestation" flow, where attestation_validator.Sign enforces
  // datum invariance. Without an attestation input being spent, the mint
  // policy would otherwise let any registered signer create a fresh
  // attestation UTxO with an arbitrary datum (e.g. impersonating another
  // original_author or skipping the description/source_code checks).
  let tx =
    build_tx(
      [signer_input()],
      [pp_ref_input()],
      [attestation_output(), signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  signature_token_policy.signature_token_policy.mint(
    MintSignatureToken {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      attestation_output_ix: 0,
      is_new_attestation: False,
    },
    mock_sig_policy,
    tx,
  )
}

// ── MintSignatureToken: property tests ───────────────────

test prop_mint_new_attestation_any_valid_datum(
  (description, source_code) via fuzz.both(
    fuzz.bytearray_between(1, 64),
    fuzz.bytearray_between(1, 64),
  ),
) {
  // Any non-empty description and source_code should be accepted.
  let fuzz_datum =
    AttestationDatum {
      original_author: mock_signer_name,
      description,
      source_code,
      script_hash: #"deadbeef",
      script_address: #"babe",
      staking_policy: #"",
      minting_policy: #"",
      counter_attestation: False,
    }
  let fuzz_output =
    Output {
      address: Address {
        payment_credential: Script(mock_attestation_validator),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_sig_policy, mock_signer_name, 1),
      datum: InlineDatum(fuzz_datum),
      reference_script: None,
    }
  let tx =
    build_tx(
      [signer_input()],
      [pp_ref_input()],
      [fuzz_output, signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  signature_token_policy.signature_token_policy.mint(
    MintSignatureToken {
      protocol_parameters_ix: 0,
      signer_input_ix: 0,
      attestation_output_ix: 0,
      is_new_attestation: True,
    },
    mock_sig_policy,
    tx,
  )
}

// ── Retire: unit tests ────────────────────────────────────

test retire_happy_path() {
  // Burning the signature token: all quantities ≤ 0.
  let tx =
    build_tx(
      [],
      [],
      [],
      assets.from_asset(mock_sig_policy, mock_signer_name, -1),
    )
  signature_token_policy.signature_token_policy.mint(Retire, mock_sig_policy, tx)
}

test retire_fails_with_positive_token() fail {
  // Positive quantity means minting, not burning: burn_correct fails.
  let tx =
    build_tx(
      [],
      [],
      [],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  signature_token_policy.signature_token_policy.mint(Retire, mock_sig_policy, tx)
}

// ── Retire: property tests ────────────────────────────────

test prop_retire_any_single_burn_amount(
  (name, qty) via fuzz.both(fuzz.bytearray(), fuzz.int_at_most(-1)),
) {
  // Any negative quantity under the policy should be accepted.
  let tx =
    build_tx([], [], [], assets.from_asset(mock_sig_policy, name, qty))
  signature_token_policy.signature_token_policy.mint(Retire, mock_sig_policy, tx)
}

// ── is_attestation_datum_correct: unit tests ─────────────

const mock_signer_name_datum: ByteArray = #"cafe"

test datum_valid_with_script_address() {
  is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: mock_signer_name_datum,
      description: #"deadbeef",
      source_code: #"cafebabe",
      script_hash: #"abcd1234",
      script_address: #"babe",
      staking_policy: #"",
      minting_policy: #"",
      counter_attestation: False,
    },
  )
}

test datum_valid_with_staking_policy() {
  is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: mock_signer_name_datum,
      description: #"deadbeef",
      source_code: #"cafebabe",
      script_hash: #"1234abcd",
      script_address: #"",
      staking_policy: #"c0ffee",
      minting_policy: #"",
      counter_attestation: False,
    },
  )
}

test datum_valid_with_minting_policy() {
  is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: mock_signer_name_datum,
      description: #"deadbeef",
      source_code: #"cafebabe",
      script_hash: #"5678efab",
      script_address: #"",
      staking_policy: #"",
      minting_policy: #"c0ffee",
      counter_attestation: False,
    },
  )
}

test datum_valid_with_all_optional_fields_filled() {
  is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: mock_signer_name_datum,
      description: #"deadbeef",
      source_code: #"cafebabe",
      script_hash: #"f00dcafe",
      script_address: #"babe",
      staking_policy: #"c0ffee",
      minting_policy: #"facade",
      counter_attestation: False,
    },
  )
}

test datum_fails_wrong_original_author() fail {
  is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: #"beef",
      description: #"deadbeef",
      source_code: #"cafebabe",
      script_hash: #"abcd1234",
      script_address: #"babe",
      staking_policy: #"",
      minting_policy: #"",
      counter_attestation: False,
    },
  )
}

test datum_fails_empty_description() fail {
  is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: mock_signer_name_datum,
      description: #"",
      source_code: #"cafebabe",
      script_hash: #"abcd1234",
      script_address: #"babe",
      staking_policy: #"",
      minting_policy: #"",
      counter_attestation: False,
    },
  )
}

test datum_fails_empty_source_code() fail {
  is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: mock_signer_name_datum,
      description: #"deadbeef",
      source_code: #"",
      script_hash: #"abcd1234",
      script_address: #"babe",
      staking_policy: #"",
      minting_policy: #"",
      counter_attestation: False,
    },
  )
}

test datum_fails_empty_script_hash() fail {
  is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: mock_signer_name_datum,
      description: #"deadbeef",
      source_code: #"cafebabe",
      script_hash: #"",
      script_address: #"babe",
      staking_policy: #"",
      minting_policy: #"",
      counter_attestation: False,
    },
  )
}

test datum_fails_all_address_and_policy_fields_empty() fail {
  is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: mock_signer_name_datum,
      description: #"deadbeef",
      source_code: #"cafebabe",
      script_hash: #"abcd1234",
      script_address: #"",
      staking_policy: #"",
      minting_policy: #"",
      counter_attestation: False,
    },
  )
}

// ── is_attestation_datum_correct: property tests ─────────

test prop_datum_valid_when_required_fields_non_empty(
  (description, source_code) via fuzz.both(
    fuzz.bytearray_between(1, 64),
    fuzz.bytearray_between(1, 64),
  ),
) {
  is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: mock_signer_name_datum,
      description,
      source_code,
      script_hash: #"deadbeef",
      script_address: #"babe",
      staking_policy: #"",
      minting_policy: #"",
      counter_attestation: False,
    },
  )
}

test prop_datum_fails_with_empty_description(
  source_code via fuzz.bytearray_between(1, 64),
) {
  !is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: mock_signer_name_datum,
      description: #"",
      source_code,
      script_hash: #"deadbeef",
      script_address: #"babe",
      staking_policy: #"",
      minting_policy: #"",
      counter_attestation: False,
    },
  )
}

test prop_datum_fails_when_all_address_fields_empty(
  (description, source_code) via fuzz.both(
    fuzz.bytearray_between(1, 64),
    fuzz.bytearray_between(1, 64),
  ),
) {
  !is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: mock_signer_name_datum,
      description,
      source_code,
      script_hash: #"deadbeef",
      script_address: #"",
      staking_policy: #"",
      minting_policy: #"",
      counter_attestation: False,
    },
  )
}

test prop_datum_any_single_address_field_is_sufficient(
  script_address via fuzz.bytearray_between(1, 64),
) {
  // At least one of the three address/policy fields being non-empty is sufficient.
  is_attestation_datum_correct(
    mock_signer_name_datum,
    AttestationDatum {
      original_author: mock_signer_name_datum,
      description: #"deadbeef",
      source_code: #"cafebabe",
      script_hash: #"abcd1234",
      script_address,
      staking_policy: #"",
      minting_policy: #"",
      counter_attestation: False,
    },
  )
}
