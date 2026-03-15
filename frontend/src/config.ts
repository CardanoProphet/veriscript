import { DEPLOYMENTS } from "./generated/protocolDeployment";

function envString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function envNumber(value: string | undefined): number | undefined {
  const parsed = envString(value);
  if (parsed === undefined) return undefined;
  const number = Number(parsed);
  return Number.isFinite(number) ? number : undefined;
}

export const API_URL = envString(import.meta.env.VITE_API_URL) ?? "http://localhost:3001";
export const BLOCKFROST_API_KEY = envString(import.meta.env.VITE_BLOCKFROST_API_KEY) ?? "";
export const CARDANO_NETWORK = (envString(import.meta.env.VITE_CARDANO_NETWORK) ?? "preprod") as
  | "preprod"
  | "mainnet";
const DEPLOYMENT = DEPLOYMENTS[CARDANO_NETWORK];

function requireReferenceScript<T extends { txHash: string; txIx: number; hash: string; cbor: string }>(
  value: T,
  name: string
): T {
  if (value.txHash === "" || value.hash === "" || value.cbor === "") {
    throw new Error(`Missing deployed reference script for ${name} on ${CARDANO_NETWORK}.`);
  }
  return value;
}

export const PROTOCOL_PARAMS_TX_HASH =
  envString(import.meta.env.VITE_PROTOCOL_PARAMS_TX_HASH) ?? DEPLOYMENT.protocolParameters.txHash ?? "";
export const PROTOCOL_PARAMS_TX_IX =
  envNumber(import.meta.env.VITE_PROTOCOL_PARAMS_TX_IX) ?? DEPLOYMENT.protocolParameters.txIx ?? 0;
export const ATTESTATION_VALIDATOR_REFERENCE = requireReferenceScript(
  DEPLOYMENT.referenceScripts.attestation_validator,
  "attestation_validator"
);
export const SIGNATURE_TOKEN_POLICY_REFERENCE = requireReferenceScript(
  DEPLOYMENT.referenceScripts.signature_token_policy,
  "signature_token_policy"
);
export const SIGNER_TOKEN_POLICY_REFERENCE = requireReferenceScript(
  DEPLOYMENT.referenceScripts.signer_token_policy,
  "signer_token_policy"
);

export const BLOCKFROST_URL =
  CARDANO_NETWORK === "mainnet"
    ? "https://cardano-mainnet.blockfrost.io/api/v0"
    : "https://cardano-preprod.blockfrost.io/api/v0";

export const EXPLORER_BASE =
  CARDANO_NETWORK === "mainnet"
    ? "https://cardanoscan.io"
    : "https://preprod.cardanoscan.io";

// Lovelace amounts used across transaction builders and UI
export const SIGNER_METADATA_LOVELACE = 2_000_000n;
export const MIN_ATTESTATION_LOVELACE = 4_000_000n;
export const MIN_ANCHOR_UTXO_LOVELACE = 6_000_000n;
export const MIN_COLLATERAL_LOVELACE = 5_000_000n;

export function explorerTx(txHash: string) {
  return `${EXPLORER_BASE}/transaction/${txHash}`;
}

export function explorerAddr(address: string) {
  return `${EXPLORER_BASE}/address/${address}`;
}
