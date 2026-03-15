import { Router, Request, Response } from "express";
import {
  fetchAllHistoricalOutputs,
  fetchAllUtxos,
  type BlockfrostUtxo,
} from "../services/blockfrost";
import { parseAttestationDatum } from "../services/datum";
import { getAddresses, getHashes } from "../config";
import type {
  AttestationConstituent,
  AttestationUtxo,
  SignatureToken,
  ApiError,
} from "../types";

const router = Router();

function extractSigners(
  amounts: { unit: string; quantity: string }[],
  signatureTokenPolicy: string,
): SignatureToken[] {
  return amounts
    .filter(
      (a) => a.unit !== "lovelace" && a.unit.startsWith(signatureTokenPolicy),
    )
    .map((a) => ({
      policyId: signatureTokenPolicy,
      tokenName: a.unit.slice(signatureTokenPolicy.length),
      quantity: a.quantity,
    }));
}

function utxoToAttestation(
  u: BlockfrostUtxo,
  signatureTokenPolicy: string,
): AttestationUtxo | null {
  if (!u.inline_datum) return null;
  const datum = parseAttestationDatum(u.inline_datum);
  if (!datum) return null;

  const signers = extractSigners(u.amount, signatureTokenPolicy);
  const lovelace = u.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0";

  const referenceScriptHash = u.reference_script_hash ?? null;
  return {
    txHash: u.tx_hash,
    txIx: u.output_index,
    datum,
    signers,
    signerCount: signers.length,
    lovelace,
    referenceScriptHash,
    constituents: [
      {
        txHash: u.tx_hash,
        txIx: u.output_index,
        lovelace,
        referenceScriptHash,
        originalAuthor: datum.original_author,
        signers,
      },
    ],
  };
}

// Merge key: content being attested to, NOT who created the UTxO.
// UTxOs with identical attested content are considered the same attestation
// regardless of which wallet created them.
function datumKey(datum: AttestationUtxo["datum"]): string {
  return [
    datum.description,
    datum.source_code,
    datum.script_hash,
    datum.script_address,
    datum.staking_policy,
    datum.minting_policy,
  ].join("\0");
}

function mergeAttestations(
  allParsed: AttestationUtxo[],
  /** Outref keys ("txHash#txIx") of currently unspent UTxOs. */
  unspentKeys: Set<string>,
): AttestationUtxo[] {
  const groups = new Map<string, AttestationUtxo[]>();
  for (const att of allParsed) {
    const key = datumKey(att.datum);
    const group = groups.get(key) ?? [];
    group.push(att);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const representative = group[0];

    const seenTokenNames = new Set<string>();
    const mergedSigners: SignatureToken[] = [];
    // Only unspent UTxOs are retirable; retired ones still contribute signers.
    const constituents: AttestationConstituent[] = [];

    for (const att of group) {
      if (unspentKeys.has(`${att.txHash}#${att.txIx}`)) {
        constituents.push(...att.constituents);
      }
      for (const signer of att.signers) {
        if (!seenTokenNames.has(signer.tokenName)) {
          seenTokenNames.add(signer.tokenName);
          mergedSigners.push(signer);
        }
      }
    }

    const referenceScriptHash =
      group.find((a) => a.referenceScriptHash)?.referenceScriptHash ?? null;

    return {
      ...representative,
      signers: mergedSigners,
      signerCount: mergedSigners.length,
      referenceScriptHash,
      constituents,
    };
  });
}

// GET /api/attestations
// Query: ?scriptHash=...&scriptAddress=...&mintingPolicy=...&page=1&limit=20
router.get(
  "/",
  async (
    req: Request<
      {},
      {},
      {},
      {
        scriptHash?: string;
        scriptAddress?: string;
        mintingPolicy?: string;
        page?: string;
        limit?: string;
      }
    >,
    res: Response<
      { attestations: AttestationUtxo[]; total: number } | ApiError
    >,
  ) => {
    try {
      const address = getAddresses().attestation_validator;
      const hashes = getHashes();

      // Fetch in parallel: full history for display, current UTxOs for retirement.
      const [historicalOutputs, currentUtxos] = await Promise.all([
        fetchAllHistoricalOutputs(address),
        fetchAllUtxos(address),
      ]);

      const unspentKeys = new Set(
        currentUtxos.map((u) => `${u.tx_hash}#${u.output_index}`),
      );

      const allParsed = historicalOutputs
        .map((u) => utxoToAttestation(u, hashes.signature_token_policy))
        .filter((a): a is AttestationUtxo => a !== null);

      let attestations = mergeAttestations(allParsed, unspentKeys);

      // Apply filters
      if (req.query.scriptHash) {
        const filter = req.query.scriptHash.toLowerCase();
        attestations = attestations.filter(
          (a) => a.datum.script_hash.toLowerCase() === filter,
        );
      }
      if (req.query.scriptAddress) {
        const filter = req.query.scriptAddress.toLowerCase();
        attestations = attestations.filter(
          (a) => a.datum.script_address.toLowerCase() === filter,
        );
      }
      if (req.query.mintingPolicy) {
        const filter = req.query.mintingPolicy.toLowerCase();
        attestations = attestations.filter(
          (a) => a.datum.minting_policy.toLowerCase() === filter,
        );
      }

      const total = attestations.length;
      const page = parseInt(req.query.page ?? "1", 10);
      const limit = Math.min(parseInt(req.query.limit ?? "20", 10), 100);
      const paginated = attestations.slice((page - 1) * limit, page * limit);

      res.json({ attestations: paginated, total });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res
        .status(500)
        .json({ error: "Failed to fetch attestations", details: message });
    }
  },
);

// GET /api/attestations/:txHash/:txIx
router.get(
  "/:txHash/:txIx",
  async (
    req: Request<{ txHash: string; txIx: string }>,
    res: Response<AttestationUtxo | ApiError>,
  ) => {
    try {
      const address = getAddresses().attestation_validator;
      const hashes = getHashes();
      const utxos = await fetchAllUtxos(address);

      const txIx = parseInt(req.params.txIx, 10);
      const u = utxos.find(
        (u) => u.tx_hash === req.params.txHash && u.output_index === txIx,
      );

      if (!u) {
        res.status(404).json({ error: "Attestation UTxO not found" });
        return;
      }

      const attestation = utxoToAttestation(u, hashes.signature_token_policy);
      if (!attestation) {
        res.status(500).json({ error: "Failed to decode attestation datum" });
        return;
      }

      res.json(attestation);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res
        .status(500)
        .json({ error: "Failed to fetch attestation", details: message });
    }
  },
);

export default router;
