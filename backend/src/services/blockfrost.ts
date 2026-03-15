import { BlockFrostAPI } from "@blockfrost/blockfrost-js";
import { BLOCKFROST_API_URL, NETWORK } from "../config";

let _client: BlockFrostAPI | null = null;

export function getBlockfrost(): BlockFrostAPI {
  if (!_client) {
    const apiKey = process.env.BLOCKFROST_API_KEY;
    if (!apiKey) {
      throw new Error("BLOCKFROST_API_KEY environment variable is not set");
    }
    _client = new BlockFrostAPI({
      projectId: apiKey,
      customBackend: BLOCKFROST_API_URL,
      network: NETWORK === "mainnet" ? "mainnet" : "preprod",
    });
  }
  return _client;
}

export type BlockfrostUtxo = Awaited<
  ReturnType<BlockFrostAPI["addressesUtxos"]>
>[number];

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status_code" in err &&
    (err as { status_code: number }).status_code === 404
  );
}

/** Fetch all UTxOs at an address, handling Blockfrost pagination. */
export async function fetchAllUtxos(
  address: string,
): Promise<BlockfrostUtxo[]> {
  const bf = getBlockfrost();
  const results: BlockfrostUtxo[] = [];
  let page = 1;

  while (true) {
    let page_results: BlockfrostUtxo[];
    try {
      page_results = await bf.addressesUtxos(address, { page, count: 100 });
    } catch (err) {
      if (isNotFound(err)) return results;
      throw err;
    }
    results.push(...page_results);
    if (page_results.length < 100) break;
    page++;
  }

  return results;
}

/**
 * Fetch all outputs ever sent to an address, including those already spent
 * (e.g. retired attestation UTxOs). Pages through the full transaction
 * history and collects every output that targeted the address.
 *
 * Note: each signing event creates a new output at the address, so the
 * same logical attestation may appear in multiple historical outputs at
 * different signer counts. The caller is expected to deduplicate signers.
 */
export async function fetchAllHistoricalOutputs(
  address: string,
): Promise<BlockfrostUtxo[]> {
  const bf = getBlockfrost();

  // Collect all tx hashes that ever involved this address.
  const txHashes: string[] = [];
  let page = 1;
  while (true) {
    let txs: { tx_hash: string }[];
    try {
      txs = await bf.addressesTransactions(address, {
        page,
        count: 100,
        order: "asc",
      });
    } catch (err) {
      if (isNotFound(err)) break;
      throw err;
    }
    txHashes.push(...txs.map((t) => t.tx_hash));
    if (txs.length < 100) break;
    page++;
  }

  // Fetch UTxOs for each transaction in parallel batches.
  const BATCH = 10;
  const results: BlockfrostUtxo[] = [];
  for (let i = 0; i < txHashes.length; i += BATCH) {
    const batch = txHashes.slice(i, i + BATCH);
    const batched = await Promise.all(
      batch.map(async (txHash) => {
        try {
          const { outputs } = await bf.txsUtxos(txHash);
          return outputs
            .filter((o) => o.address === address && o.inline_datum !== null)
            .map(
              (o) =>
                ({
                  tx_hash: txHash,
                  output_index: o.output_index,
                  amount: o.amount,
                  inline_datum: o.inline_datum,
                  reference_script_hash: o.reference_script_hash,
                }) as BlockfrostUtxo,
            );
        } catch {
          return [];
        }
      }),
    );
    results.push(...batched.flat());
  }

  return results;
}

/** Fetch UTxOs at an address that contain a specific asset. */
export async function fetchUtxosByAsset(
  address: string,
  asset: string,
): Promise<BlockfrostUtxo[]> {
  const bf = getBlockfrost();
  const results: BlockfrostUtxo[] = [];
  let page = 1;

  while (true) {
    let page_results: BlockfrostUtxo[];
    try {
      page_results = await bf.addressesUtxosAsset(address, asset, {
        page,
        count: 100,
      });
    } catch (err) {
      if (isNotFound(err)) return results;
      throw err;
    }
    results.push(...page_results);
    if (page_results.length < 100) break;
    page++;
  }

  return results;
}
