// Test module for signer_metadata_validator. No pub definitions → qualifies
// as a test module, which allows importing validators directly.
use aiken/collection/dict
use aiken/fuzz
use aiken/interval.{Interval, IntervalBound, NegativeInfinity, PositiveInfinity}
use cardano/address.{Address, Script}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use config.{protocol_parameters_script_hash}
use consts.{protocol_parameters_token}
use signer_metadata_validator
use signer_metadata_validator.{Update}
use types.{ProtocolParametersDatum, SignerMetadataDatum}

// ── Mock constants ────────────────────────────────────────

// 28 bytes = 56 hex chars
const mock_sm_validator: ByteArray =
  #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const mock_signer_policy: ByteArray =
  #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

// 32 bytes = 64 hex chars
const mock_tx_id: ByteArray =
  #"0000000000000000000000000000000000000000000000000000000000000000"

// The output_reference of the signer metadata UTxO being spent.
const mock_sm_tx_id: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const mock_sm_ix: Int = 0

const mock_token_name: ByteArray = #"cafe"

// ── Mock data builders ────────────────────────────────────

fn mock_old_metadatum() -> SignerMetadataDatum {
  SignerMetadataDatum {
    nick_name: #"616c696365",
    real_name: #"",
    contact_info: #"",
    additional_info: #"",
  }
}

fn mock_new_metadatum() -> SignerMetadataDatum {
  SignerMetadataDatum {
    nick_name: #"616c696365",
    real_name: #"416c69636520536d697468",
    contact_info: #"616c696365406578616d706c652e636f6d",
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

fn mock_out_ref() -> OutputReference {
  OutputReference { transaction_id: mock_sm_tx_id, output_index: mock_sm_ix }
}

// signer_metadata_validator only inspects inputs, reference_inputs, and outputs,
// so mint is hardcoded to the zero value.
fn build_tx(
  inputs: List<Input>,
  reference_inputs: List<Input>,
  outputs: List<Output>,
) -> Transaction {
  Transaction {
    inputs,
    reference_inputs,
    outputs,
    fee: 0,
    mint: assets.from_lovelace(0),
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
        |> assets.add(protocol_parameters_script_hash, protocol_parameters_token, 1),
      datum: InlineDatum(mock_pp_datum()),
      reference_script: None,
    },
  }
}

// The signer metadata UTxO being spent (inputs[0]).
// Its output_reference must match my_out_ref passed to spend().
fn sm_input() -> Input {
  Input {
    output_reference: mock_out_ref(),
    output: Output {
      address: Address {
        payment_credential: Script(mock_sm_validator),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, mock_token_name, 1),
      datum: InlineDatum(mock_old_metadatum()),
      reference_script: None,
    },
  }
}

// The signer's UTxO holding the signer token (inputs[1]).
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
        |> assets.add(mock_signer_policy, mock_token_name, 1),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

// Updated signer metadata UTxO (outputs[0]).
fn sm_output() -> Output {
  Output {
    address: Address {
      payment_credential: Script(mock_sm_validator),
      stake_credential: None,
    },
    value: assets.from_lovelace(2_000_000)
      |> assets.add(mock_signer_policy, mock_token_name, 1),
    datum: InlineDatum(mock_new_metadatum()),
    reference_script: None,
  }
}

// Signer's change output (outputs[1]).
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

// ── Spend: unit tests ────────────────────────────────────

test update_happy_path() {
  let tx =
    build_tx(
      [sm_input(), signer_input()],
      [pp_ref_input()],
      [sm_output(), signer_change_output()],
    )
  signer_metadata_validator.signer_metadata_validator.spend(
    Some(mock_old_metadatum()),
    Update {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_input_ix: 0,
    },
    mock_out_ref(),
    tx,
  )
}

test update_fails_wrong_sm_validator_in_pp() fail {
  // PP datum references a different signer_metadata_validator hash:
  // signer_metadata_validator_correct fails.
  let wrong_pp =
    ProtocolParametersDatum {
      signer_token_policy: mock_signer_policy,
      signer_metadata_validator: #"ff000000000000000000000000000000000000000000000000000000",
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
        datum: InlineDatum(wrong_pp),
        reference_script: None,
      },
    }
  let tx =
    build_tx(
      [sm_input(), signer_input()],
      [wrong_pp_ref],
      [sm_output(), signer_change_output()],
    )
  signer_metadata_validator.signer_metadata_validator.spend(
    Some(mock_old_metadatum()),
    Update {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_input_ix: 0,
    },
    mock_out_ref(),
    tx,
  )
}

test update_fails_no_pp_token() fail {
  // PP output missing the protocol token: protocol_token_correct fails.
  let pp_without_token =
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
  let tx =
    build_tx(
      [sm_input(), signer_input()],
      [pp_without_token],
      [sm_output(), signer_change_output()],
    )
  signer_metadata_validator.signer_metadata_validator.spend(
    Some(mock_old_metadatum()),
    Update {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_input_ix: 0,
    },
    mock_out_ref(),
    tx,
  )
}

test update_fails_sm_input_missing_token() fail {
  // Signer metadata input has no signer token:
  // the expect on its value panics.
  let sm_input_no_token =
    Input {
      output_reference: mock_out_ref(),
      output: Output {
        address: Address {
          payment_credential: Script(mock_sm_validator),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000),
        datum: InlineDatum(mock_old_metadatum()),
        reference_script: None,
      },
    }
  let tx =
    build_tx(
      [sm_input_no_token, signer_input()],
      [pp_ref_input()],
      [sm_output(), signer_change_output()],
    )
  signer_metadata_validator.signer_metadata_validator.spend(
    Some(mock_old_metadatum()),
    Update {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_input_ix: 0,
    },
    mock_out_ref(),
    tx,
  )
}

test update_fails_signer_input_missing_token() fail {
  // Signer's input has no signer token: signer_input_has_token fails.
  let signer_input_no_token =
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
        value: assets.from_lovelace(2_000_000),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let tx =
    build_tx(
      [sm_input(), signer_input_no_token],
      [pp_ref_input()],
      [sm_output(), signer_change_output()],
    )
  signer_metadata_validator.signer_metadata_validator.spend(
    Some(mock_old_metadatum()),
    Update {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_input_ix: 0,
    },
    mock_out_ref(),
    tx,
  )
}

test update_fails_wrong_output_address() fail {
  // Signer metadata output sent to wrong address:
  // signer_metadata_output_address_correct fails.
  let wrong_output =
    Output {
      address: Address {
        payment_credential: Script(mock_signer_policy),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, mock_token_name, 1),
      datum: InlineDatum(mock_new_metadatum()),
      reference_script: None,
    }
  let tx =
    build_tx(
      [sm_input(), signer_input()],
      [pp_ref_input()],
      [wrong_output, signer_change_output()],
    )
  signer_metadata_validator.signer_metadata_validator.spend(
    Some(mock_old_metadatum()),
    Update {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_input_ix: 0,
    },
    mock_out_ref(),
    tx,
  )
}

test update_fails_sm_output_missing_token() fail {
  // Signer metadata output has no signer token:
  // signer_metadata_output_value_correct fails.
  let output_no_token =
    Output {
      address: Address {
        payment_credential: Script(mock_sm_validator),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000),
      datum: InlineDatum(mock_new_metadatum()),
      reference_script: None,
    }
  let tx =
    build_tx(
      [sm_input(), signer_input()],
      [pp_ref_input()],
      [output_no_token, signer_change_output()],
    )
  signer_metadata_validator.signer_metadata_validator.spend(
    Some(mock_old_metadatum()),
    Update {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_input_ix: 0,
    },
    mock_out_ref(),
    tx,
  )
}

test update_fails_nick_name_changed() fail {
  // new_metadatum has a different nick_name: new_nick_name_correct fails.
  let new_different_nick =
    SignerMetadataDatum {
      nick_name: #"626f62",
      real_name: #"",
      contact_info: #"",
      additional_info: #"",
    }
  let output_changed_nick =
    Output {
      address: Address {
        payment_credential: Script(mock_sm_validator),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, mock_token_name, 1),
      datum: InlineDatum(new_different_nick),
      reference_script: None,
    }
  let tx =
    build_tx(
      [sm_input(), signer_input()],
      [pp_ref_input()],
      [output_changed_nick, signer_change_output()],
    )
  signer_metadata_validator.signer_metadata_validator.spend(
    Some(mock_old_metadatum()),
    Update {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_input_ix: 0,
    },
    mock_out_ref(),
    tx,
  )
}

test update_fails_wrong_out_ref() fail {
  // my_out_ref doesn't match sm_input's output_reference:
  // spend_correct fails.
  let wrong_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 99 }
  let tx =
    build_tx(
      [sm_input(), signer_input()],
      [pp_ref_input()],
      [sm_output(), signer_change_output()],
    )
  signer_metadata_validator.signer_metadata_validator.spend(
    Some(mock_old_metadatum()),
    Update {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_input_ix: 0,
    },
    wrong_out_ref,
    tx,
  )
}

test update_fails_no_datum() fail {
  // my_datum = None: expect Some(old_signer_metadatum) = my_datum panics.
  let tx =
    build_tx(
      [sm_input(), signer_input()],
      [pp_ref_input()],
      [sm_output(), signer_change_output()],
    )
  signer_metadata_validator.signer_metadata_validator.spend(
    None,
    Update {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_input_ix: 0,
    },
    mock_out_ref(),
    tx,
  )
}

// ── Spend: property tests ─────────────────────────────────

test prop_update_any_non_empty_nick_name(
  nick_name via fuzz.bytearray_between(1, 32),
) {
  // Any non-empty nick_name can be preserved across an update.
  let fuzz_old =
    SignerMetadataDatum {
      nick_name,
      real_name: #"",
      contact_info: #"",
      additional_info: #"",
    }
  let fuzz_new =
    SignerMetadataDatum {
      nick_name,
      real_name: #"416c69636520536d697468",
      contact_info: #"616c696365406578616d706c652e636f6d",
      additional_info: #"",
    }
  let fuzz_sm_input =
    Input {
      output_reference: mock_out_ref(),
      output: Output {
        address: Address {
          payment_credential: Script(mock_sm_validator),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000)
          |> assets.add(mock_signer_policy, mock_token_name, 1),
        datum: InlineDatum(fuzz_old),
        reference_script: None,
      },
    }
  let fuzz_sm_output =
    Output {
      address: Address {
        payment_credential: Script(mock_sm_validator),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, mock_token_name, 1),
      datum: InlineDatum(fuzz_new),
      reference_script: None,
    }
  let tx =
    build_tx(
      [fuzz_sm_input, signer_input()],
      [pp_ref_input()],
      [fuzz_sm_output, signer_change_output()],
    )
  signer_metadata_validator.signer_metadata_validator.spend(
    Some(fuzz_old),
    Update {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_input_ix: 0,
    },
    mock_out_ref(),
    tx,
  )
}

test prop_update_any_token_name(
  token_name via fuzz.bytearray_between(1, 32),
) {
  // Any non-empty token name is accepted as long as it is consistent
  // across sm_input, signer_input, and sm_output.
  let fuzz_sm_input =
    Input {
      output_reference: mock_out_ref(),
      output: Output {
        address: Address {
          payment_credential: Script(mock_sm_validator),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000)
          |> assets.add(mock_signer_policy, token_name, 1),
        datum: InlineDatum(mock_old_metadatum()),
        reference_script: None,
      },
    }
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
          |> assets.add(mock_signer_policy, token_name, 1),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let fuzz_sm_output =
    Output {
      address: Address {
        payment_credential: Script(mock_sm_validator),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_signer_policy, token_name, 1),
      datum: InlineDatum(mock_new_metadatum()),
      reference_script: None,
    }
  let tx =
    build_tx(
      [fuzz_sm_input, fuzz_signer_input],
      [pp_ref_input()],
      [fuzz_sm_output, signer_change_output()],
    )
  signer_metadata_validator.signer_metadata_validator.spend(
    Some(mock_old_metadatum()),
    Update {
      protocol_parameters_ix: 0,
      signer_input_ix: 1,
      signer_metadata_input_ix: 0,
    },
    mock_out_ref(),
    tx,
  )
}
