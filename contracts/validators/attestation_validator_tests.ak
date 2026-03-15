// Test module for the attestation_validator. No pub definitions → qualifies
// as a test module, which allows importing validators directly.
use aiken/collection/dict
use aiken/fuzz
use aiken/interval.{Interval, IntervalBound, NegativeInfinity, PositiveInfinity}
use attestation_validator.{Retire, Sign, is_new_signature_added}
use cardano/address.{Address, Script}
use cardano/assets.{Value}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use config.{protocol_parameters_script_hash}
use consts.{protocol_parameters_token}
use types.{AttestationDatum, ProtocolParametersDatum}

// ── is_new_signature_added: unit tests ──────────────────

test sign_added_lovelace_only_input() {
  let token = #"cafe"
  let input = assets.from_lovelace(2_000_000)
  let output =
    assets.from_lovelace(2_000_000) |> assets.add(mock_policy_a, token, 1)
  is_new_signature_added(input, mock_policy_a, token, output)
}

test sign_added_preserves_existing_tokens() {
  let existing = #"beef"
  let new_tok = #"cafe"
  let input =
    assets.from_lovelace(2_000_000) |> assets.add(mock_policy_b, existing, 1)
  let output =
    assets.from_lovelace(2_000_000)
      |> assets.add(mock_policy_b, existing, 1)
      |> assets.add(mock_policy_a, new_tok, 1)
  is_new_signature_added(input, mock_policy_a, new_tok, output)
}

test sign_added_extra_ada_tolerated() {
  let token = #"cafe"
  let input = assets.from_lovelace(2_000_000)
  let output =
    assets.from_lovelace(10_000_000) |> assets.add(mock_policy_a, token, 1)
  is_new_signature_added(input, mock_policy_a, token, output)
}

test sign_added_fails_token_absent() fail {
  let token = #"cafe"
  let input = assets.from_lovelace(2_000_000)
  let output = assets.from_lovelace(2_000_000)
  is_new_signature_added(input, mock_policy_a, token, output)
}

test sign_added_fails_wrong_policy() fail {
  let token = #"cafe"
  let input = assets.from_lovelace(2_000_000)
  // Token minted under mock_policy_b, but expected under mock_policy_a.
  let output =
    assets.from_lovelace(2_000_000) |> assets.add(mock_policy_b, token, 1)
  is_new_signature_added(input, mock_policy_a, token, output)
}

test sign_added_fails_existing_token_lost_from_output() fail {
  let existing = #"beef"
  let new_tok = #"cafe"
  let input =
    assets.from_lovelace(2_000_000) |> assets.add(mock_policy_b, existing, 1)
  // Output has the new token but is missing the original token.
  let output =
    assets.from_lovelace(2_000_000) |> assets.add(mock_policy_a, new_tok, 1)
  is_new_signature_added(input, mock_policy_a, new_tok, output)
}

// ── is_new_signature_added: property tests ──────────────

test prop_sign_added_always_succeeds_when_token_present(
  (token_name, lovelace) via fuzz.both(
    fuzz.bytearray_between(1, 32),
    fuzz.int_at_least(1_000_000),
  ),
) {
  let input = assets.from_lovelace(lovelace)
  let output =
    assets.from_lovelace(lovelace) |> assets.add(mock_policy_a, token_name, 1)
  is_new_signature_added(input, mock_policy_a, token_name, output)
}

test prop_sign_added_always_fails_without_token(
  (token_name, lovelace) via fuzz.both(
    fuzz.bytearray_between(1, 32),
    fuzz.int_at_least(1_000_000),
  ),
) {
  let input = assets.from_lovelace(lovelace)
  let output = assets.from_lovelace(lovelace)
  !is_new_signature_added(input, mock_policy_a, token_name, output)
}

test prop_sign_added_preserves_arbitrary_existing_tokens(
  (new_tok, extra_tok) via fuzz.both(
    fuzz.bytearray_between(1, 32),
    fuzz.bytearray_between(1, 32),
  ),
) {
  let input =
    assets.from_lovelace(2_000_000) |> assets.add(mock_policy_b, extra_tok, 1)
  let output =
    assets.from_lovelace(2_000_000)
      |> assets.add(mock_policy_b, extra_tok, 1)
      |> assets.add(mock_policy_a, new_tok, 1)
  is_new_signature_added(input, mock_policy_a, new_tok, output)
}

// ── Mock constants ────────────────────────────────────────

// 28 bytes = 56 hex chars
const mock_policy_a: ByteArray =
  #"11111111111111111111111111111111111111111111111111111111"

const mock_policy_b: ByteArray =
  #"22222222222222222222222222222222222222222222222222222222"

const mock_attestation_hash: ByteArray =
  #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const mock_signer_policy: ByteArray =
  #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

const mock_sig_policy: ByteArray =
  #"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3"

const mock_sm_validator: ByteArray =
  #"d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4"

// 32 bytes = 64 hex chars
const mock_tx_id: ByteArray =
  #"0000000000000000000000000000000000000000000000000000000000000000"

const mock_signer_name: ByteArray = #"cafe"

// ── Mock data builders ────────────────────────────────────

fn mock_pp_datum() -> ProtocolParametersDatum {
  ProtocolParametersDatum {
    signer_token_policy: mock_signer_policy,
    signer_metadata_validator: mock_sm_validator,
    signature_token_policy: mock_sig_policy,
    attestation_validator: mock_attestation_hash,
  }
}

fn mock_attest_datum() -> AttestationDatum {
  AttestationDatum {
    original_author: mock_signer_name,
    description: #"deadbeef",
    source_code: #"cafebabe",
    script_hash: #"abcd1234",
    script_address: #"babe",
    staking_policy: #"",
    minting_policy: #"",
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

fn attest_input_unsigned() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: mock_tx_id,
      output_index: 0,
    },
    output: Output {
      address: Address {
        payment_credential: Script(mock_attestation_hash),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000),
      datum: InlineDatum(mock_attest_datum()),
      reference_script: None,
    },
  }
}

fn attest_input_signed() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: mock_tx_id,
      output_index: 0,
    },
    output: Output {
      address: Address {
        payment_credential: Script(mock_attestation_hash),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_sig_policy, mock_signer_name, 1),
      datum: InlineDatum(mock_attest_datum()),
      reference_script: None,
    },
  }
}

fn signer_input() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: mock_tx_id,
      output_index: 1,
    },
    output: Output {
      address: Address {
        payment_credential: Script(mock_signer_policy),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, mock_signer_name, 1),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn attest_output_signed() -> Output {
  Output {
    address: Address {
      payment_credential: Script(mock_attestation_hash),
      stake_credential: None,
    },
    value: assets.from_lovelace(2_000_000)
      |> assets.add(mock_sig_policy, mock_signer_name, 1),
    datum: InlineDatum(mock_attest_datum()),
    reference_script: None,
  }
}

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

// ── Sign: unit tests ─────────────────────────────────────

test sign_happy_path() {
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 0 }
  let tx =
    build_tx(
      [attest_input_unsigned(), signer_input()],
      [pp_ref_input()],
      [attest_output_signed(), signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  attestation_validator.attestation_validator.spend(
    Some(mock_attest_datum()),
    Sign {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      attestation_input_ix: 0,
    },
    my_out_ref,
    tx,
  )
}

test sign_fails_wrong_out_ref() fail {
  // my_out_ref doesn't match attestation input's output_reference: spend_correct fails.
  let wrong_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 99 }
  let tx =
    build_tx(
      [attest_input_unsigned(), signer_input()],
      [pp_ref_input()],
      [attest_output_signed(), signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  attestation_validator.attestation_validator.spend(
    Some(mock_attest_datum()),
    Sign {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      attestation_input_ix: 0,
    },
    wrong_out_ref,
    tx,
  )
}

test sign_fails_already_signed() fail {
  // Attestation input already carries the signer's token: not_signed_yet fails.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 0 }
  let tx =
    build_tx(
      [attest_input_signed(), signer_input()],
      [pp_ref_input()],
      [attest_output_signed(), signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  attestation_validator.attestation_validator.spend(
    Some(mock_attest_datum()),
    Sign {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      attestation_input_ix: 0,
    },
    my_out_ref,
    tx,
  )
}

test sign_fails_datum_changed() fail {
  // Output datum differs from input datum: attestation_datum_correct fails.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 0 }
  let different_datum =
    AttestationDatum {
      original_author: mock_signer_name,
      description: #"c0ffee",
      source_code: #"cafebabe",
      script_hash: #"abcd1234",
      script_address: #"babe",
      staking_policy: #"",
      minting_policy: #"",
    }
  let different_output =
    Output {
      address: Address {
        payment_credential: Script(mock_attestation_hash),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_sig_policy, mock_signer_name, 1),
      datum: InlineDatum(different_datum),
      reference_script: None,
    }
  let tx =
    build_tx(
      [attest_input_unsigned(), signer_input()],
      [pp_ref_input()],
      [different_output, signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  attestation_validator.attestation_validator.spend(
    Some(mock_attest_datum()),
    Sign {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      attestation_input_ix: 0,
    },
    my_out_ref,
    tx,
  )
}

test sign_fails_no_pp_token() fail {
  // PP reference input missing the protocol token: protocol_token_correct fails.
  let pp_no_token =
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
        value: assets.from_lovelace(2_000_000),
        datum: InlineDatum(mock_pp_datum()),
        reference_script: None,
      },
    }
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 0 }
  let tx =
    build_tx(
      [attest_input_unsigned(), signer_input()],
      [pp_no_token],
      [attest_output_signed(), signer_change_output()],
      assets.from_asset(mock_sig_policy, mock_signer_name, 1),
    )
  attestation_validator.attestation_validator.spend(
    Some(mock_attest_datum()),
    Sign {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      attestation_input_ix: 0,
    },
    my_out_ref,
    tx,
  )
}

// ── Sign: property tests ─────────────────────────────────

test prop_sign_any_signer_name(signer_name via fuzz.bytearray_between(1, 32)) {
  // For any signer token name the happy path should succeed.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 0 }
  let fuzz_signer_input =
    Input {
      output_reference: OutputReference {
        transaction_id: mock_tx_id,
        output_index: 1,
      },
      output: Output {
        address: Address {
          payment_credential: Script(mock_signer_policy),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000)
          |> assets.add(mock_signer_policy, signer_name, 1),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let fuzz_attest_output =
    Output {
      address: Address {
        payment_credential: Script(mock_attestation_hash),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_sig_policy, signer_name, 1),
      datum: InlineDatum(mock_attest_datum()),
      reference_script: None,
    }
  let tx =
    build_tx(
      [attest_input_unsigned(), fuzz_signer_input],
      [pp_ref_input()],
      [fuzz_attest_output, signer_change_output()],
      assets.from_asset(mock_sig_policy, signer_name, 1),
    )
  attestation_validator.attestation_validator.spend(
    Some(mock_attest_datum()),
    Sign {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      attestation_input_ix: 0,
    },
    my_out_ref,
    tx,
  )
}

// ── Retire: unit tests ───────────────────────────────────

test retire_happy_path() {
  // Original author retires the attestation and burns the signature token.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 0 }
  let tx =
    build_tx(
      [attest_input_signed(), signer_input()],
      [pp_ref_input()],
      [],
      assets.from_asset(mock_sig_policy, mock_signer_name, -1),
    )
  attestation_validator.attestation_validator.spend(
    Some(mock_attest_datum()),
    Retire {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      attestation_input_ix: 0,
    },
    my_out_ref,
    tx,
  )
}

test retire_fails_wrong_original_author() fail {
  // Signer presents #"beef" but original_author is #"cafe": original_author_correct fails.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 0 }
  let impostor_signer =
    Input {
      output_reference: OutputReference {
        transaction_id: mock_tx_id,
        output_index: 1,
      },
      output: Output {
        address: Address {
          payment_credential: Script(mock_signer_policy),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000)
          |> assets.add(mock_signer_policy, #"beef", 1),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let tx =
    build_tx(
      [attest_input_signed(), impostor_signer],
      [pp_ref_input()],
      [],
      assets.from_asset(mock_sig_policy, #"beef", -1),
    )
  attestation_validator.attestation_validator.spend(
    Some(mock_attest_datum()),
    Retire {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      attestation_input_ix: 0,
    },
    my_out_ref,
    tx,
  )
}

test retire_fails_incomplete_burn() fail {
  // Signature token is not burnt in mint: burn_correct fails.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 0 }
  let tx =
    build_tx(
      [attest_input_signed(), signer_input()],
      [pp_ref_input()],
      [],
      assets.from_lovelace(0),
    )
  attestation_validator.attestation_validator.spend(
    Some(mock_attest_datum()),
    Retire {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      attestation_input_ix: 0,
    },
    my_out_ref,
    tx,
  )
}
