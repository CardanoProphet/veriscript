use aiken/collection/dict
use aiken/collection/dict/strategy
use aiken/collection/list
use cardano/address.{Address, Script}
use cardano/assets.{AssetName, PolicyId, Value, quantity_of, tokens}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config.{protocol_parameters_script_hash}
use consts.{protocol_parameters_token}
use types.{AttestationDatum, ProtocolParametersDatum}

/// The redeemer options for the attestation validator:
/// - **Sign** is used when a new signer attaches his signature
///   token to the Utxo.
/// - **Retire** can only be invoked by "original_author" in case
///   this attestation is no longer relevant.
pub type AttestationValidatorRedeemer {
  Sign {
    protocol_parameters_ix: Int,
    signer_input_ix: Int,
    attestation_input_ix: Int,
  }
  Retire {
    protocol_parameters_ix: Int,
    signer_input_ix: Int,
    attestation_input_ix: Int,
  }
}

/// Checks that `output_value` contains at least the same
/// tokens as `input_value` with the additional
/// `new_token_policy`.`new_token_name`. Additional Ada
/// amounts are tolerated.
pub fn is_new_signature_added(
  input_value: Value,
  new_token_policy: PolicyId,
  new_token_name: AssetName,
  output_value: Value,
) -> Bool {
  let expanded_input_value =
    assets.add(input_value, new_token_policy, new_token_name, 1)
  assets.match(output_value, expanded_input_value, >=)
}

/// The attestation validator's main purpose is to safeguard
/// the attestations users have signed.
///
/// As such, it allows the following operations:
/// - **Sign** allows new signatures to be attached.
/// - **Retire** allows deleting the Utxo and burning all
///   signature tokens in case it is no longer needed
///   (hence this allows unlocking the minimum Ada contained
///   by the Utxo)
validator attestation_validator {
  spend(
    datum: Option<AttestationDatum>,
    redeemer: AttestationValidatorRedeemer,
    my_out_ref: OutputReference,
    tx: Transaction,
  ) {
    when redeemer is {
      Sign { protocol_parameters_ix, signer_input_ix, attestation_input_ix } -> {
        let Transaction { inputs, reference_inputs, mint, outputs, .. } = tx

        expect Some(old_attestation) = datum

        expect Some(Input {
          output_reference,
          output: Output {
            address: Address { payment_credential: my_script_credential, .. },
            value: attestation_input_value,
            ..
          },
        }) = list.at(inputs, attestation_input_ix)
        expect Script(my_hash) = my_script_credential
        let spend_correct = my_out_ref == output_reference

        expect Some(Input {
          output: Output {
            datum: protocol_parameters_datum,
            value: protocol_parameters_value,
            ..
          },
          ..
        }) = list.at(reference_inputs, protocol_parameters_ix)
        expect InlineDatum(protocol_parameters_data) = protocol_parameters_datum
        expect ProtocolParametersDatum {
          signer_token_policy,
          signature_token_policy,
          attestation_validator,
          ..
        } = protocol_parameters_data

        expect Some(Input {
          output: Output { value: signer_input_value, .. },
          ..
        }) = list.at(inputs, signer_input_ix)
        expect [Pair(signer_token_name, 1)] =
          tokens(signer_input_value, signer_token_policy) |> dict.to_pairs

        let mint_tokens = tokens(mint, signature_token_policy)

        expect [attestation_output, _signer_output] = outputs
        let Output {
          address: Address { payment_credential: attestation_address, .. },
          datum: attestation_datum,
          value: attestation_value,
          ..
        } = attestation_output
        expect InlineDatum(attestation_data) = attestation_datum
        expect new_attestation: AttestationDatum = attestation_data

        // 1. Protocol parameters have the protocol token.
        let protocol_token_correct =
          quantity_of(
            protocol_parameters_value,
            protocol_parameters_script_hash,
            protocol_parameters_token,
          ) == 1

        // 2. Protocol parameters references my policy.
        let attestation_validator_correct = my_hash == attestation_validator

        // 3. Signer token is minted.
        let mint_correct =
          dict.to_pairs(mint_tokens) == [Pair(signer_token_name, 1)]

        // 4. Attestation input does not have signature token yet.
        let not_signed_yet =
          quantity_of(
            attestation_input_value,
            signature_token_policy,
            signer_token_name,
          ) == 0

        // 5. Attestation output goes to the right address.
        let attestation_address_correct =
          attestation_address == my_script_credential

        // 6. Signature tokens correct on output.
        let attestation_value_correct =
          is_new_signature_added(
            attestation_input_value,
            signature_token_policy,
            signer_token_name,
            attestation_value,
          )

        // 7. Attestation datum is unchanged.
        let attestation_datum_correct = old_attestation == new_attestation

        spend_correct? && protocol_token_correct? && attestation_validator_correct? && mint_correct? && not_signed_yet? && attestation_address_correct? && attestation_value_correct? && attestation_datum_correct?
      }

      Retire { protocol_parameters_ix, signer_input_ix, attestation_input_ix } -> {
        let Transaction { inputs, reference_inputs, mint, .. } = tx

        expect Some(attestation) = datum

        expect Some(Input {
          output_reference,
          output: Output {
            address: Address { payment_credential: my_script_credential, .. },
            value: attestation_input_value,
            ..
          },
        }) = list.at(inputs, attestation_input_ix)
        expect Script(my_hash) = my_script_credential
        let spend_correct = my_out_ref == output_reference

        expect Some(Input {
          output: Output {
            datum: protocol_parameters_datum,
            value: protocol_parameters_value,
            ..
          },
          ..
        }) = list.at(reference_inputs, protocol_parameters_ix)
        expect InlineDatum(protocol_parameters_data) = protocol_parameters_datum
        expect ProtocolParametersDatum {
          signer_token_policy,
          signature_token_policy,
          attestation_validator,
          ..
        } = protocol_parameters_data

        expect Some(Input {
          output: Output { value: signer_input_value, .. },
          ..
        }) = list.at(inputs, signer_input_ix)
        expect [Pair(signer_token_name, 1)] =
          tokens(signer_input_value, signer_token_policy) |> dict.to_pairs

        let mint_tokens = tokens(mint, signature_token_policy)
        let input_tokens =
          tokens(attestation_input_value, signature_token_policy)

        // 1. Protocol parameters have the protocol token.
        let protocol_token_correct =
          quantity_of(
            protocol_parameters_value,
            protocol_parameters_script_hash,
            protocol_parameters_token,
          ) == 1

        // 2. Protocol parameters references my policy.
        let attestation_validator_correct = my_hash == attestation_validator

        // 3. Original author's token is spent.
        let original_author_correct =
          attestation.original_author == signer_token_name

        // 4. All the signature tokens are burnt.
        let sum_tokens =
          dict.union_with(input_tokens, mint_tokens, strategy.sum_if_non_zero())
        let burn_correct = dict.is_empty(sum_tokens)

        spend_correct? && protocol_token_correct? && attestation_validator_correct? && original_author_correct? && burn_correct?
      }
    }
  }

  else(_) {
    fail @"unsupported purpose"
  }
}
