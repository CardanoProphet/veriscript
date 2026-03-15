use aiken/collection/dict
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, quantity_of, tokens}
use cardano/transaction.{InlineDatum, Input, Output, Transaction}
use config.{protocol_parameters_script_hash}
use consts.{protocol_parameters_token}
use types.{AttestationDatum, ProtocolParametersDatum}

/// The signature token minting policy has the following
/// redeemer options:
/// - **MintSignatureToken** is used for minting signature tokens
///   that attest the agreement on the attestation data by the signer.
/// - **Retire** is used by the creator of the attestation when
///   retiring the Utxo and burning all the signature tokens with it.
pub type SignatureTokenPolicyRedeemer {
  MintSignatureToken {
    protocol_parameters_ix: Int,
    signer_input_ix_option: Int,
  }
  Retire
}

/// Checks that the `attestation_datum` is correct.
pub fn is_attestation_datum_correct(
  signer_token_name: ByteArray,
  attestation_datum: AttestationDatum,
) -> Bool {
  let AttestationDatum {
    original_author,
    description,
    source_code,
    script_hash,
    script_address,
    staking_policy,
    minting_policy,
  } = attestation_datum

  let original_author_correct = original_author == signer_token_name
  let description_correct = !bytearray.is_empty(description)
  let source_code_correct = !bytearray.is_empty(source_code)
  let script_hash_correct = !bytearray.is_empty(script_hash)
  let script_address_or_policy_correct =
    !bytearray.is_empty(script_address) || !bytearray.is_empty(staking_policy) || !bytearray.is_empty(
      minting_policy,
    )

  original_author_correct? && description_correct? && source_code_correct? && script_hash_correct? && script_address_or_policy_correct?
}

/// The signature minting policy is responsible for minting
/// and burning the signature tokens safely.
validator signature_token_policy {
  mint(
    redeemer: SignatureTokenPolicyRedeemer,
    my_policy_id: PolicyId,
    tx: Transaction,
  ) {
    when redeemer is {
      MintSignatureToken { protocol_parameters_ix, signer_input_ix_option } -> {
        let Transaction { inputs, reference_inputs, mint, outputs, .. } = tx

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

        let signer_input_value =
          when signer_input_ix_option is {
            -1 -> {
              expect [signer_input] = inputs
              let Input { output: Output { address: addr, value: x, .. }, .. } =
                signer_input
              expect addr.payment_credential != Script(attestation_validator)
              x
            }
            signer_input_ix -> {
              expect Some(Input { output: Output { value: x, .. }, .. }) =
                list.at(inputs, signer_input_ix)
              x
            }
          }
        expect [Pair(signer_token_name, 1)] =
          tokens(signer_input_value, signer_token_policy) |> dict.to_pairs

        let mint_tokens = tokens(mint, my_policy_id)

        expect [attestation_output, _signer_output] = outputs
        let Output {
          address: Address { payment_credential: attestation_address, .. },
          datum: attestation_datum,
          value: attestation_value,
          ..
        } = attestation_output
        expect InlineDatum(attestation_data) = attestation_datum
        expect attestation: AttestationDatum = attestation_data

        // 1. Protocol parameters have the protocol token.
        let protocol_token_correct =
          quantity_of(
            protocol_parameters_value,
            protocol_parameters_script_hash,
            protocol_parameters_token,
          ) == 1

        // 2. Protocol parameters references my policy.
        let signature_token_policy_correct =
          my_policy_id == signature_token_policy

        // 3. Signature token is minted.
        let mint_correct =
          dict.to_pairs(mint_tokens) == [Pair(signer_token_name, 1)]

        // 4. Attestation output goes to the right address.
        let attestation_address_correct =
          attestation_address == Script(attestation_validator)

        // 5. Signature token is on the attestation output.
        let attestation_value_correct =
          quantity_of(
            attestation_value,
            signature_token_policy,
            signer_token_name,
          ) == 1

        // 6. Attestation datum is correct.
        let attestation_datum_correct =
          when signer_input_ix_option is {
            -1 -> is_attestation_datum_correct(signer_token_name, attestation)
            _ -> True
          }

        protocol_token_correct? && signature_token_policy_correct? && mint_correct? && attestation_address_correct? && attestation_value_correct? && attestation_datum_correct?
      }

      Retire -> {
        let mint = tx.mint
        let my_tokens = tokens(mint, my_policy_id) |> dict.to_pairs
        let burn_correct =
          list.all(my_tokens, fn(Pair(_token_name, x)) { x <= 0 })
        burn_correct?
      }
    }
  }

  else(_) {
    fail @"unsupported purpose"
  }
}

