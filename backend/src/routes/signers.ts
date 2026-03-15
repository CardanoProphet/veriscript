import { Router, Request, Response } from "express";
import { fetchAllUtxos, type BlockfrostUtxo } from "../services/blockfrost";
import { parseSignerMetadataDatum } from "../services/datum";
import { getAddresses, getHashes } from "../config";
import type { SignerUtxo, ApiError } from "../types";

const router = Router();

function utxoToSigner(
  u: BlockfrostUtxo,
  signerTokenPolicy: string,
): SignerUtxo | null {
  if (!u.inline_datum) return null;
  const metadata = parseSignerMetadataDatum(u.inline_datum);
  if (!metadata) return null;

  // Find the signer token in this UTxO (there should be exactly 1)
  const tokenAsset = u.amount.find(
    (a) => a.unit !== "lovelace" && a.unit.startsWith(signerTokenPolicy),
  );
  if (!tokenAsset) return null;

  const tokenName = tokenAsset.unit.slice(signerTokenPolicy.length);
  const lovelace = u.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0";

  return {
    txHash: u.tx_hash,
    txIx: u.output_index,
    tokenName,
    policy: signerTokenPolicy,
    metadata,
    lovelace,
  };
}

// GET /api/signers
router.get(
  "/",
  async (
    req: Request<{}, {}, {}, { page?: string; limit?: string }>,
    res: Response<{ signers: SignerUtxo[]; total: number } | ApiError>,
  ) => {
    try {
      const address = getAddresses().signer_metadata_validator;
      const hashes = getHashes();
      const utxos = await fetchAllUtxos(address);

      const signers = utxos
        .map((u) => utxoToSigner(u, hashes.signer_token_policy))
        .filter((s): s is SignerUtxo => s !== null);

      const total = signers.length;
      const page = parseInt(req.query.page ?? "1", 10);
      const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 100);
      const paginated = signers.slice((page - 1) * limit, page * limit);

      res.json({ signers: paginated, total });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res
        .status(500)
        .json({ error: "Failed to fetch signers", details: message });
    }
  },
);

// GET /api/signers/:policyId/:tokenName
router.get(
  "/:policyId/:tokenName",
  async (
    req: Request<{ policyId: string; tokenName: string }>,
    res: Response<SignerUtxo | ApiError>,
  ) => {
    try {
      const address = getAddresses().signer_metadata_validator;
      const hashes = getHashes();
      const utxos = await fetchAllUtxos(address);

      const { policyId, tokenName } = req.params;
      const asset = policyId + tokenName;

      const u = utxos.find((u) => u.amount.some((a) => a.unit === asset));

      if (!u) {
        res.status(404).json({ error: "Signer not found" });
        return;
      }

      const signer = utxoToSigner(u, hashes.signer_token_policy);
      if (!signer) {
        res.status(500).json({ error: "Failed to decode signer metadata" });
        return;
      }

      res.json(signer);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res
        .status(500)
        .json({ error: "Failed to fetch signer", details: message });
    }
  },
);

export default router;
