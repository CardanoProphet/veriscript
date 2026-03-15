import { Router, Request, Response } from "express";
import { fetchUtxosByAsset, type BlockfrostUtxo } from "../services/blockfrost";
import { parseProtocolParametersDatum } from "../services/datum";
import {
  getAddresses,
  getHashes,
  PROTOCOL_PARAMETERS_TOKEN_HEX,
} from "../config";
import type { ApiError, ProtocolParamsUtxo } from "../types";

const router = Router();

router.get(
  "/",
  async (_req: Request, res: Response<ProtocolParamsUtxo | ApiError>) => {
    try {
      const address = getAddresses().protocol_parameters;
      const hashes = getHashes();
      const asset = hashes.protocol_parameters + PROTOCOL_PARAMETERS_TOKEN_HEX;

      const utxos: BlockfrostUtxo[] = await fetchUtxosByAsset(address, asset);

      if (utxos.length === 0) {
        res.status(404).json({ error: "Protocol parameters UTxO not found" });
        return;
      }

      // Use the first (and should be only) protocol parameters UTxO
      const u = utxos[0];
      if (!u.inline_datum) {
        res
          .status(500)
          .json({ error: "Protocol parameters UTxO has no inline datum" });
        return;
      }

      const datum = parseProtocolParametersDatum(u.inline_datum);
      if (!datum) {
        res
          .status(500)
          .json({ error: "Failed to decode protocol parameters datum" });
        return;
      }

      const lovelace =
        u.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0";

      res.json({
        txHash: u.tx_hash,
        txIx: u.output_index,
        datum,
        lovelace,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({
        error: "Failed to fetch protocol parameters",
        details: message,
      });
    }
  },
);

export default router;
