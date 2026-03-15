export interface AttestationDatum {
  original_author: string; // hex
  description: string;
  source_code: string;
  script_hash: string; // hex
  script_address: string;
  staking_policy: string; // hex or empty
  minting_policy: string; // hex or empty
}

export interface SignerMetadataDatum {
  nick_name: string;
  real_name: string;
  contact_info: string;
  additional_info: string;
}

export interface ProtocolParametersDatum {
  signer_token_policy: string; // hex
  signer_metadata_validator: string; // hex
  signature_token_policy: string; // hex
  attestation_validator: string; // hex
}

export interface SignatureToken {
  policyId: string;
  tokenName: string; // hex
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
  constituents: AttestationConstituent[];
}

export interface SignerUtxo {
  txHash: string;
  txIx: number;
  tokenName: string; // hex
  policy: string;
  metadata: SignerMetadataDatum;
  lovelace: string;
}

export interface ProtocolParamsUtxo {
  txHash: string;
  txIx: number;
  datum: ProtocolParametersDatum;
  lovelace: string;
}

export interface BackendConfig {
  network: string;
  hashes: {
    attestation_validator: string;
    protocol_parameters: string;
    signature_token_policy: string;
    signer_metadata_validator: string;
    signer_token_policy: string;
  };
  addresses: {
    attestation_validator: string;
    protocol_parameters: string;
    signer_metadata_validator: string;
  };
}

export type OutRef = { txHash: string; txIndex: number };

export interface ReferenceScriptDeployment {
  txHash: string;
  txIx: number;
  hash: string;
  cbor: string;
}

export interface SignerUtxoInfo {
  txHash: string;
  txIndex: number;
  tokenName: string;
  amount: { unit: string; quantity: string }[];
}

export interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}
