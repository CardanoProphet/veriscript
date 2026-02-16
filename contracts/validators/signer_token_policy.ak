use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{sha3_256}
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, quantity_of, tokens}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config.{protocol_parameters_script_hash}
use consts.{protocol_parameters_token}
use types.{ProtocolParametersDatum, SignerMetadataDatum}

/// Check that the signer metadata is correct. (Currently only
/// the `nick_name` field is mandatory, all others are optional.)
fn is_signer_metadatum_correct(datum: SignerMetadataDatum) -> Bool {
  let SignerMetadataDatum { nick_name, .. } = datum
  !bytearray.is_empty(nick_name)
}

/// The signer token minting policy governs the correct creation of the
/// signer tokens:
/// - one is attached to the signer metadata Utxo
/// - the other is given to the signer, who can use it for
///   - updating the signer metadata
///   - minting his own signature tokens for attestation
validator signer_token_policy {
  mint(redeemer: Int, my_policy_id: PolicyId, tx: Transaction) {
    let Transaction { inputs, reference_inputs, mint, outputs, .. } = tx

    expect [signer_input] = inputs
    let OutputReference { transaction_id, output_index } =
      signer_input.output_reference
    let signer_token_name =
      sha3_256(bytearray.push(transaction_id, output_index))

    expect Some(Input {
      output: Output {
        datum: protocol_parameters_datum,
        value: protocol_parameters_value,
        ..
      },
      ..
    }) = list.at(reference_inputs, redeemer)
    expect InlineDatum(protocol_parameters_data) = protocol_parameters_datum
    expect ProtocolParametersDatum {
      signer_token_policy,
      signer_metadata_validator,
      ..
    } = protocol_parameters_data

    let mint_tokens = tokens(mint, my_policy_id)

    expect [signer_metadata_output, _signer_output] = outputs
    let Output {
      address: Address { payment_credential: signer_metadata_address, .. },
      datum: signer_metadata_datum,
      value: signer_metadata_value,
      ..
    } = signer_metadata_output
    expect InlineDatum(signer_metadata_data) = signer_metadata_datum
    expect signer_metadatum: SignerMetadataDatum = signer_metadata_data

    // 1. Protocol parameters have the protocol token.
    let protocol_token_correct =
      quantity_of(
        protocol_parameters_value,
        protocol_parameters_script_hash,
        protocol_parameters_token,
      ) == 1

    // 2. Protocol parameters references my policy.
    let signer_token_policy_correct = my_policy_id == signer_token_policy

    // 3. Signer tokens are minted.
    let mint_correct =
      dict.to_pairs(mint_tokens) == [Pair(signer_token_name, 2)]

    // 4. Signer metadata has right address.
    let signer_metadata_address_correct =
      signer_metadata_address == Script(signer_metadata_validator)

    // 5. Signer matadata UTxO gets one token.
    let signer_metadata_value_correct =
      quantity_of(signer_metadata_value, signer_token_policy, signer_token_name) == 1

    // 6. Signer metadata datum is correct.
    let signer_metadatum_correct = is_signer_metadatum_correct(signer_metadatum)

    protocol_token_correct? && signer_token_policy_correct? && mint_correct? && signer_metadata_address_correct? && signer_metadata_value_correct? && signer_metadatum_correct?
  }

  else(_) {
    fail @"unsupported purpose"
  }
}
