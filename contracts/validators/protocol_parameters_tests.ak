// Test module for protocol_parameters. No pub definitions → qualifies
// as a test module, which allows importing validators directly.
use aiken/collection/dict
use aiken/fuzz
use aiken/interval.{Interval, IntervalBound, NegativeInfinity, PositiveInfinity}
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{Value}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use config
use consts.{protocol_parameters_token}
use protocol_parameters.{
  Mint, MintRetireProtocol, RetireScript, SpendRetireProtocol, Update,
  admin_token,
}
use types.{ProtocolParametersDatum}

// ── Mock constants ────────────────────────────────────────

// 28 bytes = 56 hex chars
const mock_policy: ByteArray =
  #"11111111111111111111111111111111111111111111111111111111"

// 32 bytes = 64 hex chars
const mock_tx_id: ByteArray =
  #"0000000000000000000000000000000000000000000000000000000000000000"

// ── Mock data builders ────────────────────────────────────

fn mock_pp_datum() -> ProtocolParametersDatum {
  ProtocolParametersDatum {
    signer_token_policy: #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
    signer_metadata_validator: #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2",
    signature_token_policy: #"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3",
    attestation_validator: #"d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4",
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

// The UTxO that must be spent at deployment (its output_reference must
// match config.anchor_tx_id / config.anchor_ix exactly).
fn anchor_input() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: config.anchor_tx_id,
      output_index: config.anchor_ix,
    },
    output: Output {
      address: Address {
        payment_credential: Script(mock_policy),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

// Deployer input carrying the admin token.
fn deployer_input() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: mock_tx_id,
      output_index: 0,
    },
    output: Output {
      address: Address {
        payment_credential: Script(mock_policy),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_policy, admin_token, 1),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

// Protocol parameters UTxo at output_index 1, so my_out_ref = {mock_tx_id, 1}.
fn pp_input() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: mock_tx_id,
      output_index: 1,
    },
    output: Output {
      address: Address {
        payment_credential: Script(mock_policy),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_policy, protocol_parameters_token, 1),
      datum: InlineDatum(mock_pp_datum()),
      reference_script: Some(mock_policy),
    },
  }
}

fn pp_output() -> Output {
  Output {
    address: Address {
      payment_credential: Script(mock_policy),
      stake_credential: None,
    },
    value: assets.from_lovelace(2_000_000)
      |> assets.add(mock_policy, protocol_parameters_token, 1),
    datum: InlineDatum(mock_pp_datum()),
    reference_script: Some(mock_policy),
  }
}

fn change_output() -> Output {
  Output {
    address: Address {
      payment_credential: Script(mock_policy),
      stake_credential: None,
    },
    value: assets.from_lovelace(2_000_000),
    datum: NoDatum,
    reference_script: None,
  }
}

// ── Mint: Mint redeemer unit tests ────────────────────────

test mint_happy_path() {
  let tx =
    build_tx(
      [anchor_input()],
      [],
      [pp_output(), change_output()],
      assets.from_asset(mock_policy, admin_token, 1)
        |> assets.add(mock_policy, protocol_parameters_token, 1),
    )
  protocol_parameters.protocol_parameters.mint(Mint, mock_policy, tx)
}

test mint_fails_wrong_anchor() fail {
  // Anchor input has wrong tx_id: anchor_ref_spent fails.
  let wrong_anchor =
    Input {
      output_reference: OutputReference {
        transaction_id: mock_tx_id,
        output_index: config.anchor_ix,
      },
      output: Output {
        address: Address {
          payment_credential: Script(mock_policy),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let tx =
    build_tx(
      [wrong_anchor],
      [],
      [pp_output(), change_output()],
      assets.from_asset(mock_policy, admin_token, 1)
        |> assets.add(mock_policy, protocol_parameters_token, 1),
    )
  protocol_parameters.protocol_parameters.mint(Mint, mock_policy, tx)
}

test mint_fails_missing_protocol_parameters_token() fail {
  // Only admin token in mint, no protocol_parameters_token: mint_correct fails.
  let tx =
    build_tx(
      [anchor_input()],
      [],
      [pp_output(), change_output()],
      assets.from_asset(mock_policy, admin_token, 1),
    )
  protocol_parameters.protocol_parameters.mint(Mint, mock_policy, tx)
}

// ── Mint: Mint redeemer property tests ───────────────────

test prop_mint_any_pp_datum(
  ((sp, smv), (sigp, av)) via fuzz.both(
    fuzz.both(fuzz.bytearray(), fuzz.bytearray()),
    fuzz.both(fuzz.bytearray(), fuzz.bytearray()),
  ),
) {
  // Mint accepts any well-formed ProtocolParametersDatum.
  let fuzz_datum =
    ProtocolParametersDatum {
      signer_token_policy: sp,
      signer_metadata_validator: smv,
      signature_token_policy: sigp,
      attestation_validator: av,
    }
  let fuzz_pp_output =
    Output {
      address: Address {
        payment_credential: Script(mock_policy),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_policy, protocol_parameters_token, 1),
      datum: InlineDatum(fuzz_datum),
      reference_script: Some(mock_policy),
    }
  let tx =
    build_tx(
      [anchor_input()],
      [],
      [fuzz_pp_output, change_output()],
      assets.from_asset(mock_policy, admin_token, 1)
        |> assets.add(mock_policy, protocol_parameters_token, 1),
    )
  protocol_parameters.protocol_parameters.mint(Mint, mock_policy, tx)
}

// ── Mint: MintRetireProtocol redeemer unit tests ─────────

test mint_retire_protocol_happy_path() {
  // Both admin and protocol_parameters tokens burnt.
  let tx =
    build_tx(
      [],
      [],
      [],
      assets.from_asset(mock_policy, admin_token, -1)
        |> assets.add(mock_policy, protocol_parameters_token, -1),
    )
  protocol_parameters.protocol_parameters.mint(
    MintRetireProtocol,
    mock_policy,
    tx,
  )
}

test mint_retire_protocol_fails_incomplete_burn() fail {
  // Only admin_token burnt, protocol_parameters_token missing: burn_correct fails.
  let tx = build_tx([], [], [], assets.from_asset(mock_policy, admin_token, -1))
  protocol_parameters.protocol_parameters.mint(
    MintRetireProtocol,
    mock_policy,
    tx,
  )
}

// ── Spend: Update redeemer unit tests ────────────────────

test update_happy_path() {
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 1 }
  let tx =
    build_tx(
      [deployer_input(), pp_input()],
      [],
      [pp_output(), change_output()],
      assets.from_lovelace(0),
    )
  protocol_parameters.protocol_parameters.spend(
    None,
    Update { deployer_ix: 0, protocol_parameters_ix: 1 },
    my_out_ref,
    tx,
  )
}

test update_fails_no_admin_token() fail {
  // Deployer carries no admin token: admin_token_spent fails.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 1 }
  let no_admin_input =
    Input {
      output_reference: OutputReference {
        transaction_id: mock_tx_id,
        output_index: 0,
      },
      output: Output {
        address: Address {
          payment_credential: Script(mock_policy),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let tx =
    build_tx(
      [no_admin_input, pp_input()],
      [],
      [pp_output(), change_output()],
      assets.from_lovelace(0),
    )
  protocol_parameters.protocol_parameters.spend(
    None,
    Update { deployer_ix: 0, protocol_parameters_ix: 1 },
    my_out_ref,
    tx,
  )
}

test update_fails_wrong_output_address() fail {
  // Protocol output sent to a different script address: protocol_address_correct fails.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 1 }
  let wrong_address =
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let wrong_pp_output =
    Output {
      address: Address {
        payment_credential: Script(wrong_address),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_policy, protocol_parameters_token, 1),
      datum: InlineDatum(mock_pp_datum()),
      reference_script: Some(mock_policy),
    }
  let tx =
    build_tx(
      [deployer_input(), pp_input()],
      [],
      [wrong_pp_output, change_output()],
      assets.from_lovelace(0),
    )
  protocol_parameters.protocol_parameters.spend(
    None,
    Update { deployer_ix: 0, protocol_parameters_ix: 1 },
    my_out_ref,
    tx,
  )
}

test update_fails_pp_output_no_reference_script() fail {
  // Output has reference_script: None instead of Some(policy): script_correct fails.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 1 }
  let no_script_output =
    Output {
      address: Address {
        payment_credential: Script(mock_policy),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_policy, protocol_parameters_token, 1),
      datum: InlineDatum(mock_pp_datum()),
      reference_script: None,
    }
  let tx =
    build_tx(
      [deployer_input(), pp_input()],
      [],
      [no_script_output, change_output()],
      assets.from_lovelace(0),
    )
  protocol_parameters.protocol_parameters.spend(
    None,
    Update { deployer_ix: 0, protocol_parameters_ix: 1 },
    my_out_ref,
    tx,
  )
}

// ── Spend: Update redeemer property tests ────────────────

test prop_update_any_pp_datum(
  ((sp, smv), (sigp, av)) via fuzz.both(
    fuzz.both(fuzz.bytearray(), fuzz.bytearray()),
    fuzz.both(fuzz.bytearray(), fuzz.bytearray()),
  ),
) {
  // Update accepts any well-formed ProtocolParametersDatum on the output.
  let fuzz_datum =
    ProtocolParametersDatum {
      signer_token_policy: sp,
      signer_metadata_validator: smv,
      signature_token_policy: sigp,
      attestation_validator: av,
    }
  let fuzz_pp_input =
    Input {
      output_reference: OutputReference {
        transaction_id: mock_tx_id,
        output_index: 1,
      },
      output: Output {
        address: Address {
          payment_credential: Script(mock_policy),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000)
          |> assets.add(mock_policy, protocol_parameters_token, 1),
        datum: InlineDatum(fuzz_datum),
        reference_script: Some(mock_policy),
      },
    }
  let fuzz_pp_output =
    Output {
      address: Address {
        payment_credential: Script(mock_policy),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000)
        |> assets.add(mock_policy, protocol_parameters_token, 1),
      datum: InlineDatum(fuzz_datum),
      reference_script: Some(mock_policy),
    }
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 1 }
  let tx =
    build_tx(
      [deployer_input(), fuzz_pp_input],
      [],
      [fuzz_pp_output, change_output()],
      assets.from_lovelace(0),
    )
  protocol_parameters.protocol_parameters.spend(
    None,
    Update { deployer_ix: 0, protocol_parameters_ix: 1 },
    my_out_ref,
    tx,
  )
}

// ── Spend: RetireScript redeemer unit tests ───────────────

test retire_script_happy_path() {
  // Admin spends a UTxO at the protocol script address.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 1 }
  let tx =
    build_tx([deployer_input(), pp_input()], [], [], assets.from_lovelace(0))
  protocol_parameters.protocol_parameters.spend(
    None,
    RetireScript { deployer_ix: 0, protocol_ix: 1 },
    my_out_ref,
    tx,
  )
}

test retire_script_fails_no_admin_token() fail {
  // Deployer carries no admin token: admin_token_spent fails.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 1 }
  let no_admin_input =
    Input {
      output_reference: OutputReference {
        transaction_id: mock_tx_id,
        output_index: 0,
      },
      output: Output {
        address: Address {
          payment_credential: Script(mock_policy),
          stake_credential: None,
        },
        value: assets.from_lovelace(2_000_000),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let tx =
    build_tx([no_admin_input, pp_input()], [], [], assets.from_lovelace(0))
  protocol_parameters.protocol_parameters.spend(
    None,
    RetireScript { deployer_ix: 0, protocol_ix: 1 },
    my_out_ref,
    tx,
  )
}

// ── Spend: SpendRetireProtocol redeemer unit tests ────────

test spend_retire_protocol_happy_path() {
  // Admin burns the admin token to retire the whole protocol.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 1 }
  let tx =
    build_tx(
      [deployer_input(), pp_input()],
      [],
      [],
      assets.from_asset(mock_policy, admin_token, -1),
    )
  protocol_parameters.protocol_parameters.spend(
    None,
    SpendRetireProtocol { protocol_parameters_ix: 1 },
    my_out_ref,
    tx,
  )
}

test spend_retire_protocol_fails_admin_not_burnt() fail {
  // Admin token absent from mint: admin_token_burnt fails.
  let my_out_ref =
    OutputReference { transaction_id: mock_tx_id, output_index: 1 }
  let tx =
    build_tx([deployer_input(), pp_input()], [], [], assets.from_lovelace(0))
  protocol_parameters.protocol_parameters.spend(
    None,
    SpendRetireProtocol { protocol_parameters_ix: 1 },
    my_out_ref,
    tx,
  )
}

// ── Constant sanity checks ────────────────────────────────

test admin_token_constant_is_correct() {
  admin_token == "Admin"
}

test protocol_parameters_token_constant_is_correct() {
  protocol_parameters_token == "ProtocolParameters"
}

test admin_token_sorts_before_protocol_parameters_token() {
  // Dict ordering depends on "Admin" < "ProtocolParameters".
  // Verified here so any rename breaks this test first.
  bytearray.compare(admin_token, protocol_parameters_token) == Less
}
