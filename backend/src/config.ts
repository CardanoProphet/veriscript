import { bech32 } from "bech32";
import { DEPLOYMENTS } from "./generated/protocolDeployment";

export type Network = "mainnet" | "preprod";

export const NETWORK: Network =
  (process.env.CARDANO_NETWORK as Network) || "preprod";

export function getHashes() {
  return DEPLOYMENTS[NETWORK].hashes;
}

// "ProtocolParameters" as UTF-8 hex
export const PROTOCOL_PARAMETERS_TOKEN_HEX =
  "50726f746f636f6c506172616d6574657273";

export function getAddresses() {
  return DEPLOYMENTS[NETWORK].addresses;
}

export const BLOCKFROST_API_URL =
  NETWORK === "mainnet"
    ? "https://cardano-mainnet.blockfrost.io/api/v0"
    : "https://cardano-preprod.blockfrost.io/api/v0";
