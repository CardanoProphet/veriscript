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

function extractFields(decoded: unknown): unknown[] {
  if (decoded instanceof cbor.Tagged) {
    const val = decoded.value;
    if (Array.isArray(val)) return val;
  }
  return [];
}

function toBoolField(value: unknown): boolean {
  // Plutus Bool: False = Constr 0 (tag 121), True = Constr 1 (tag 122)
  if (value instanceof cbor.Tagged) return value.tag === 122;
  return false;
}

export function parseAttestationDatum(hex: string): AttestationDatum | null {
  try {
    const decoded = cbor.decodeFirstSync(Buffer.from(hex, "hex"));
    const fields = extractFields(decoded);
    if (fields.length !== 7 && fields.length !== 8) return null;

    return {
      original_author: toBuffer(fields[0]).toString("hex"),
      description: bufferToUtf8OrHex(toBuffer(fields[1])),
      source_code: bufferToUtf8OrHex(toBuffer(fields[2])),
      script_hash: toBuffer(fields[3]).toString("hex"),
      script_address: bufferToUtf8OrHex(toBuffer(fields[4])),
      staking_policy: toBuffer(fields[5]).toString("hex"),
      minting_policy: toBuffer(fields[6]).toString("hex"),
      counter_attestation: fields.length === 8 ? toBoolField(fields[7]) : false,
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
      nick_name: bufferToUtf8OrHex(toBuffer(fields[0])),
      real_name: bufferToUtf8OrHex(toBuffer(fields[1])),
      contact_info: bufferToUtf8OrHex(toBuffer(fields[2])),
      additional_info: bufferToUtf8OrHex(toBuffer(fields[3])),
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
      signer_token_policy: toBuffer(fields[0]).toString("hex"),
      signer_metadata_validator: toBuffer(fields[1]).toString("hex"),
      signature_token_policy: toBuffer(fields[2]).toString("hex"),
      attestation_validator: toBuffer(fields[3]).toString("hex"),
    };
  } catch {
    return null;
  }
}
