use aiken/cbor.{serialise}
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{sha3_256}
use aiken/primitive/bytearray
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{PolicyId, quantity_of, tokens}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config.{protocol_parameters_script_hash}
use consts.{protocol_parameters_token}
use types.{ProtocolParametersDatum, SignerMetadataDatum}

/// The redeemer for the signer token minting policy. Indices let the
/// builder use multiple wallet UTxOs and emit additional change outputs.
pub type SignerTokenPolicyRedeemer {
  protocol_parameters_ix: Int,
  signer_input_ix: Int,
  signer_metadata_output_ix: Int,
}

/// Check that the signer metadata is correct. (Currently only
/// the `nick_name` field is mandatory, all others are optional.)
pub fn is_signer_metadatum_correct(datum: SignerMetadataDatum) -> Bool {
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
  mint(
    redeemer: SignerTokenPolicyRedeemer,
    my_policy_id: PolicyId,
    tx: Transaction,
  ) {
    let SignerTokenPolicyRedeemer {
      protocol_parameters_ix,
      signer_input_ix,
      signer_metadata_output_ix,
    } = redeemer
    let Transaction { inputs, reference_inputs, mint, outputs, .. } = tx

    expect Some(signer_input) = list.at(inputs, signer_input_ix)
    let OutputReference { transaction_id, output_index } =
      signer_input.output_reference
    let signer_token_name =
      sha3_256(bytearray.concat(transaction_id, serialise(output_index)))

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
      signer_metadata_validator,
      ..
    } = protocol_parameters_data

    let mint_tokens = tokens(mint, my_policy_id)

    expect Some(signer_metadata_output) =
      list.at(outputs, signer_metadata_output_ix)
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

    // 7. The second minted signer token must end up at a wallet
    //    (VerificationKey) address. If it landed at a script address it
    //    would be unusable — the spend validators (attestation_validator.Sign,
    //    attestation_validator.Retire, signer_metadata_validator.Update,
    //    signature_token_policy.MintSignatureToken) all require the signer
    //    input to come from a VerificationKey address, so a script-locked
    //    second token would permanently brick the signer's identity.
    let second_token_at_wallet =
      list.any(
        outputs,
        fn(o) {
          when o.address.payment_credential is {
            VerificationKey(_) ->
              quantity_of(o.value, my_policy_id, signer_token_name) >= 1
            _ -> False
          }
        },
      )

    protocol_token_correct? && signer_token_policy_correct? && mint_correct? && signer_metadata_address_correct? && signer_metadata_value_correct? && signer_metadatum_correct? && second_token_at_wallet?
  }

  else(_) {
    fail @"unsupported purpose"
  }
}
