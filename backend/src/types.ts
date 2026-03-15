export interface AttestationDatum {
  original_author: string; // hex - signer token name of creator
  description: string; // UTF-8 human-readable description
  source_code: string; // UTF-8 URL (e.g. GitHub commit link)
  script_hash: string; // hex - hash of the compiled script
  script_address: string; // UTF-8 bech32 address or empty
  staking_policy: string; // hex or empty
  minting_policy: string; // hex or empty
}

export interface SignerMetadataDatum {
  nick_name: string; // UTF-8 (mandatory)
  real_name: string; // UTF-8 (optional)
  contact_info: string; // UTF-8 (optional)
  additional_info: string; // UTF-8 (optional)
}

export interface ProtocolParametersDatum {
  signer_token_policy: string; // hex policy hash
  signer_metadata_validator: string; // hex script hash
  signature_token_policy: string; // hex policy hash
  attestation_validator: string; // hex script hash
}

export interface SignatureToken {
  policyId: string;
  tokenName: string; // hex - matches the signer's token name
  quantity: string;
}

export interface AttestationConstituent {
  txHash: string;
  txIx: number;
  lovelace: string;
  referenceScriptHash: string | null;
  originalAuthor: string;
  signers: SignatureToken[];
}

export interface AttestationUtxo {
  txHash: string;
  txIx: number;
  datum: AttestationDatum;
  signers: SignatureToken[];
  signerCount: number;
  lovelace: string;
  referenceScriptHash: string | null;
  /** Populated when multiple UTxOs share the same attested content. */
  constituents: AttestationConstituent[];
}

export interface SignerUtxo {
  txHash: string;
  txIx: number;
  tokenName: string; // hex
  policy: string; // signer_token_policy hash
  metadata: SignerMetadataDatum;
  lovelace: string;
}

export interface ProtocolParamsUtxo {
  txHash: string;
  txIx: number;
  datum: ProtocolParametersDatum;
  lovelace: string;
}

export interface ApiError {
  error: string;
  details?: string;
}
