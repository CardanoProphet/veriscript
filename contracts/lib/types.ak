/// The VeriScript "Protocol parameters" datum type.
/// Contains all the required validators and minting policies,
/// to avoid circular dependencies.
/// Also supports protocol upgrades, that can be done by
/// the owner of the protocol "Admin" token.
pub type ProtocolParametersDatum {
  signer_token_policy: ByteArray,
  signer_metadata_validator: ByteArray,
  signature_token_policy: ByteArray,
  attestation_validator: ByteArray,
}

/// The signer metadata holds the identifiers the signer
/// is comfortable sharing with the community. This
/// information can be used to further increase trust in
/// a particular signer.
///
/// Notes:
/// - only `nick_name` is mandatory, all other fields are optional
/// - ensuring the euthenticity of the data contained in the datum
///   is outside of the protocol and hence may show non-factual information
pub type SignerMetadataDatum {
  nick_name: ByteArray,
  real_name: ByteArray,
  contact_info: ByteArray,
  additional_info: ByteArray,
}

/// The attestation datum that describes the information the signer
/// has validated.
///
/// - **original_author**: is the creator of the attestation datum,
///   the only one that can "retire" the Utxo in case it is no longer relevant (mandatory)
/// - **description**: the human readable description of the script used to identify
///   the contract (mandatory)
/// - **source_code**: the link to the repository of the source code, should target
///   the specific version of the source code used for building (mandatory)
/// - **script_hash**: the hash of the compiled script (mandatory)
/// - **script_address**, **staking_policy** and **minting_policy**: should point
///   to the actual values of the compiled code where applicable (at least one of them
///   must be filled)
pub type AttestationDatum {
  original_author: ByteArray,
  description: ByteArray,
  source_code: ByteArray,
  script_hash: ByteArray,
  script_address: ByteArray,
  staking_policy: ByteArray,
  minting_policy: ByteArray,
}
