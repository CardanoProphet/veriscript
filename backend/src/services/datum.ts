import * as cbor from "cbor";
import type {
  AttestationDatum,
  SignerMetadataDatum,
  ProtocolParametersDatum,
} from "../types";

function bufferToUtf8OrHex(buf: Buffer): string {
  try {
    // Try to decode as UTF-8; fall back to hex for binary data
    const str = buf.toString("utf8");
    // Check if it's valid printable UTF-8 (not binary garbage)
    if (/^[\x20-\x7E\u00A0-\uFFFF]*$/.test(str)) return str;
    return buf.toString("hex");
  } catch {
    return buf.toString("hex");
  }
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.alloc(0);
}

function extractFields(decoded: unknown): Buffer[] {
  if (decoded instanceof cbor.Tagged) {
    const val = decoded.value;
    if (Array.isArray(val)) return val.map(toBuffer);
  }
  return [];
}

export function parseAttestationDatum(hex: string): AttestationDatum | null {
  try {
    const decoded = cbor.decodeFirstSync(Buffer.from(hex, "hex"));
    const fields = extractFields(decoded);
    if (fields.length !== 7) return null;

    return {
      original_author: fields[0].toString("hex"),
      description: bufferToUtf8OrHex(fields[1]),
      source_code: bufferToUtf8OrHex(fields[2]),
      script_hash: fields[3].toString("hex"),
      script_address: bufferToUtf8OrHex(fields[4]),
      staking_policy: fields[5].toString("hex"),
      minting_policy: fields[6].toString("hex"),
    };
  } catch {
    return null;
  }
}

export function parseSignerMetadataDatum(
  hex: string,
): SignerMetadataDatum | null {
  try {
    const decoded = cbor.decodeFirstSync(Buffer.from(hex, "hex"));
    const fields = extractFields(decoded);
    if (fields.length !== 4) return null;

    return {
      nick_name: bufferToUtf8OrHex(fields[0]),
      real_name: bufferToUtf8OrHex(fields[1]),
      contact_info: bufferToUtf8OrHex(fields[2]),
      additional_info: bufferToUtf8OrHex(fields[3]),
    };
  } catch {
    return null;
  }
}

export function parseProtocolParametersDatum(
  hex: string,
): ProtocolParametersDatum | null {
  try {
    const decoded = cbor.decodeFirstSync(Buffer.from(hex, "hex"));
    const fields = extractFields(decoded);
    if (fields.length !== 4) return null;

    return {
      signer_token_policy: fields[0].toString("hex"),
      signer_metadata_validator: fields[1].toString("hex"),
      signature_token_policy: fields[2].toString("hex"),
      attestation_validator: fields[3].toString("hex"),
    };
  } catch {
    return null;
  }
}
