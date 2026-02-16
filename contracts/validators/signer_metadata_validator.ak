use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, Script}
use cardano/assets.{quantity_of, tokens}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config.{protocol_parameters_script_hash}
use consts.{protocol_parameters_token}
use types.{ProtocolParametersDatum, SignerMetadataDatum}

/// The signer metadata validator allows only **Update**-ing
/// the data enclosed in the Utxo datum.
pub type SignerMetadataRedeemer {
  Update {
    protocol_parameters_ix: Int,
    signer_input_ix: Int,
    signer_metadata_input_ix: Int,
  }
}

/// The signer metadata validator ensures that only
/// the owner of the appropriate signer token can update
/// the signer metadata.
validator signer_metadata_validator {
  spend(
    my_datum: Option<SignerMetadataDatum>,
    redeemer: SignerMetadataRedeemer,
    my_out_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(old_signer_metadatum) = my_datum

    let Update {
      protocol_parameters_ix,
      signer_input_ix,
      signer_metadata_input_ix,
    } = redeemer

    let Transaction { inputs, reference_inputs, outputs, .. } = tx

    expect Some(Input {
      output_reference,
      output: Output {
        address: Address { payment_credential: my_script_credential, .. },
        value: my_value,
        ..
      },
    }) = list.at(inputs, signer_metadata_input_ix)
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
      signer_metadata_validator,
      signer_token_policy,
      ..
    } = protocol_parameters_data

    expect [Pair(signer_token_name, 1)] =
      tokens(my_value, signer_token_policy) |> dict.to_pairs

    expect Some(Input { output: Output { value: signer_input_value, .. }, .. }) =
      list.at(inputs, signer_input_ix)

    expect [signer_metadata_output, _signer_ouput] = outputs
    let Output {
      address: Address {
        payment_credential: signer_metadata_output_address,
        ..
      },
      datum: signer_metadata_output_datum,
      value: signer_metadata_output_value,
      ..
    } = signer_metadata_output
    expect InlineDatum(signer_metadata_output_data) =
      signer_metadata_output_datum
    expect new_signer_metadatum: SignerMetadataDatum =
      signer_metadata_output_data

    // 1. Protocol parameters have the protocol token.
    let protocol_token_correct =
      quantity_of(
        protocol_parameters_value,
        protocol_parameters_script_hash,
        protocol_parameters_token,
      ) == 1

    // 2. Protocol parameters references my policy.
    let signer_metadata_validator_correct = my_hash == signer_metadata_validator

    // 3. Signer token is spent.
    let signer_input_has_token =
      quantity_of(signer_input_value, signer_token_policy, signer_token_name) == 1

    // 4. Signer metadata output on correct address.
    let signer_metadata_output_address_correct =
      my_script_credential == signer_metadata_output_address

    // 5. Signer metadata output has token.
    let signer_metadata_output_value_correct =
      quantity_of(
        signer_metadata_output_value,
        signer_token_policy,
        signer_token_name,
      ) == 1

    // 6. New metadata has the same nick_name as the old.
    let new_nick_name_correct =
      old_signer_metadatum.nick_name == new_signer_metadatum.nick_name

    spend_correct? && protocol_token_correct? && signer_metadata_validator_correct? && signer_input_has_token? && signer_metadata_output_address_correct? && signer_metadata_output_value_correct? && new_nick_name_correct?
  }

  else(_) {
    fail @"unsupported purpose"
  }
}
