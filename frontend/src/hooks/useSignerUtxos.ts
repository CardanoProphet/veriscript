import { useState, useEffect } from "react";
import { BrowserWallet } from "@meshsdk/core";
import type { SignerUtxoInfo } from "../types";

export function useSignerUtxos(wallet: BrowserWallet, policy: string) {
  const [signerUtxos, setSignerUtxos] = useState<SignerUtxoInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    wallet.getUtxos().then((utxos) => {
      const found: SignerUtxoInfo[] = [];
      for (const u of utxos) {
        for (const asset of u.output.amount) {
          if (asset.unit !== "lovelace" && asset.unit.startsWith(policy)) {
            found.push({
              txHash: u.input.txHash,
              txIndex: u.input.outputIndex,
              tokenName: asset.unit.slice(policy.length),
              amount: u.output.amount,
            });
          }
        }
      }
      setSignerUtxos(found);
    }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { signerUtxos, loading };
}
