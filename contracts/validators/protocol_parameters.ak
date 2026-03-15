use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, quantity_of, tokens}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use consts.{protocol_parameters_token}
use types.{ProtocolParametersDatum}

/// The asset name of the admin token.
pub const admin_token = "Admin"

/// The redeemer options for the protocol parameters
/// minting policy:
/// - **Mint** is used for minting the protocol parameters
///   authenticator token along with the admin token.
/// - **MintRetireProtocol** is used for burning the
///   protocol parameters token along with the admin token.
pub type ProtocolParametersMintRedeemer {
  Mint
  MintRetireProtocol
}

/// The redeemer options for the protocol parameters validator:
/// - **Update** is invoked by the admin to upgrade the protocol.
/// - **RetireScript** is used to delete the unneeded reference
///   script Utxos.
/// - **SpendRetireProtocol** can be used to delete the
///   protocol parameters in case this version of the VeriScript
///   protocol is retired.
pub type ProtocolParametersSpendRedeemer {
  Update { deployer_ix: Int, protocol_parameters_ix: Int }
  RetireScript { deployer_ix: Int, protocol_ix: Int }
  SpendRetireProtocol { protocol_parameters_ix: Int }
}

/// The protocol parameters script has multiple uses:
/// 1. It acts as a minting policy for the protocol parameters
///    and admin tokens, which are both minted at deployment.
/// 2. Also governs burning rules: the tokens should be burned
///    together.
/// 3. As a validator it governs the protocol parameters Utxo,
///    which holds the protocol values that other scripts depend
///    on.
/// 4. It also make sure that only the admin can spend the reference
///    Utxos that are sent to this address. This ensures that these
///    "reference" Utxos are available for the purposes of holding
///    the necessry reference scripts.
validator protocol_parameters {
  mint(
    redeemer: ProtocolParametersMintRedeemer,
    policy_id: PolicyId,
    tx: Transaction,
  ) {
    when redeemer is {
      Mint -> {
        let Transaction { inputs, mint, outputs, .. } = tx

        // 1. Anchor must be spent.
        expect [anchor_utxo] = inputs
        let Input { output_reference: anchor_ref, .. } = anchor_utxo
        let anchor_ref_spent =
          anchor_ref == OutputReference {
            transaction_id: config.anchor_tx_id,
            output_index: config.anchor_ix,
          }

        // 2. Exactly 1 of Admin token and 1 ProtocolParameters token are minted.
        expect [Pair(mint_token1, 1),
          Pair(mint_token2, 1)] = tokens(mint, policy_id) |> dict.to_pairs
        let mint_correct =
          mint_token1 == admin_token && mint_token2 == protocol_parameters_token || mint_token2 == admin_token && mint_token1 == protocol_parameters_token

        // 3. The ProtocolParameters token is sent to the address of this script.
        expect [protocol_utxo, _change] = outputs
        let Output {
          address: protocol_address,
          value: protocol_value,
          datum: protocol_datum,
          reference_script: protocol_script,
        } = protocol_utxo
        let protocol_address_correct =
          protocol_address.payment_credential == Script(policy_id)
        let protocol_value_correct =
          quantity_of(protocol_value, policy_id, protocol_parameters_token) == 1

        // 4. The form of the ProtocolParameters datum is correct.
        expect InlineDatum(protocol_data) = protocol_datum
        expect ProtocolParametersDatum { .. } = protocol_data

        // 5. Protocol reference script is correct.
        let script_correct = protocol_script == Some(policy_id)

        anchor_ref_spent? && mint_correct? && protocol_address_correct? && protocol_value_correct? && script_correct?
      }

      MintRetireProtocol -> {
        let Transaction { mint, .. } = tx

        // 1. Both Admin and ProtocolParameters token are burnt.
        expect [Pair(mint_token1, -1),
          Pair(mint_token2, -1)] = tokens(mint, policy_id) |> dict.to_pairs
        let burn_correct =
          mint_token1 == admin_token && mint_token2 == protocol_parameters_token || mint_token2 == admin_token && mint_token1 == protocol_parameters_token

        burn_correct
      }
    }
  }

  spend(
    _datum: Option<Data>,
    redeemer: ProtocolParametersSpendRedeemer,
    my_out_ref: OutputReference,
    tx: Transaction,
  ) {
    when redeemer is {
      Update { deployer_ix, protocol_parameters_ix } -> {
        let Transaction { inputs, outputs, .. } = tx

        expect Some(Input {
          output_reference,
          output: Output {
            address: Address { payment_credential: my_script_credential, .. },
            ..
          },
        }) = list.at(inputs, protocol_parameters_ix)
        expect Script(my_hash) = my_script_credential
        let spend_correct = my_out_ref == output_reference

        // 1. AdminToken is spent.
        expect Some(Input { output: deployer_input, .. }) =
          list.at(inputs, deployer_ix)
        let admin_token_spent =
          quantity_of(deployer_input.value, my_hash, admin_token) == 1

        // 2. The ProtocolParameters token is sent to the address of this script.
        expect [protocol_utxo, _change] = outputs
        let Output {
          address: protocol_address,
          value: protocol_value,
          datum: protocol_datum,
          reference_script: protocol_script,
        } = protocol_utxo
        let protocol_address_correct =
          protocol_address.payment_credential == my_script_credential
        let protocol_value_correct =
          quantity_of(protocol_value, my_hash, protocol_parameters_token) == 1

        // 3. The form of the ProtocolParameters datum is correct.
        expect InlineDatum(protocol_data) = protocol_datum
        expect ProtocolParametersDatum { .. } = protocol_data

        // 4. Protocol reference script is correct.
        let script_correct = protocol_script == Some(my_hash)

        spend_correct? && admin_token_spent? && protocol_address_correct? && protocol_value_correct? && script_correct?
      }

      RetireScript { deployer_ix, protocol_ix } -> {
        let Transaction { inputs, .. } = tx

        expect Some(Input {
          output_reference,
          output: Output {
            address: Address { payment_credential: my_script_credential, .. },
            value: protocol_value,
            ..
          },
        }) = list.at(inputs, protocol_ix)
        expect Script(my_hash) = my_script_credential
        let spend_correct = my_out_ref == output_reference

        // 1. AdminToken is spent.
        expect Some(Input { output: deployer_input, .. }) =
          list.at(inputs, deployer_ix)
        let admin_token_spent =
          quantity_of(deployer_input.value, my_hash, admin_token) == 1

        // 2. Protocol input does not have the ProtocolParamaters token.
        let protocol_value_correct =
          quantity_of(protocol_value, my_hash, protocol_parameters_token) == 1

        spend_correct? && admin_token_spent? && protocol_value_correct?
      }

      SpendRetireProtocol { protocol_parameters_ix } -> {
        let Transaction { inputs, mint, .. } = tx

        expect Some(Input {
          output_reference,
          output: Output {
            address: Address { payment_credential: my_script_credential, .. },
            ..
          },
        }) = list.at(inputs, protocol_parameters_ix)
        expect Script(my_hash) = my_script_credential
        let spend_correct = my_out_ref == output_reference

        // 1. AdminToken is burnt.
        let admin_token_burnt = quantity_of(mint, my_hash, admin_token) == -1

        spend_correct? && admin_token_burnt?
      }
    }
  }

  else(_) {
    fail @"unsupported purpose"
  }
}

