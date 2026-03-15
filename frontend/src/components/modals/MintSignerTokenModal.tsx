import { useState } from "react";
import { BrowserWallet } from "@meshsdk/core";
import { Modal, Field, Input, Textarea, SubmitButton } from "./Modal";
import { mintSignerToken } from "../../services/transactions";
import type { ProtocolParametersDatum } from "../../types";
import { explorerTx, MIN_ANCHOR_UTXO_LOVELACE } from "../../config";

interface Props {
  wallet: BrowserWallet;
  protocolDatum: ProtocolParametersDatum;
  signerMetadataAddress: string;
  onClose: () => void;
  onSuccess: (txHash: string) => void;
  onError: (msg: string) => void;
}

export function MintSignerTokenModal({
  wallet,
  protocolDatum,
  signerMetadataAddress,
  onClose,
  onSuccess,
  onError,
}: Props) {
  const [nickName, setNickName] = useState("");
  const [realName, setRealName] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [utxos, setUtxos] = useState<{ txHash: string; txIndex: number; lovelace: string }[]>([]);
  const [selectedUtxo, setSelectedUtxo] = useState<string>("");
  const [fetchingUtxos, setFetchingUtxos] = useState(false);

  async function fetchUtxos() {
    setFetchingUtxos(true);
    try {
      const all = await wallet.getUtxos();
      const filtered = all
        .map((u) => {
          const lovelace = u.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0";
          return {
            txHash: u.input.txHash,
            txIndex: u.input.outputIndex,
            lovelace,
            amount: u.output.amount,
          };
        })
        .filter((u) => BigInt(u.lovelace) >= MIN_ANCHOR_UTXO_LOVELACE)
        .sort((a, b) => Number(BigInt(b.lovelace) - BigInt(a.lovelace)));
      setUtxos(filtered);
    } finally {
      setFetchingUtxos(false);
    }
  }

  async function handleSubmit() {
    if (!nickName.trim()) { onError("Nickname is required"); return; }
    if (!selectedUtxo) { onError("Please select an anchor UTxO"); return; }

    const [txHash, txIndexStr] = selectedUtxo.split(":");
    const txIndex = Number(txIndexStr);
    const utxoData = utxos.find((u) => u.txHash === txHash && u.txIndex === txIndex);
    if (!utxoData) { onError("UTxO not found"); return; }

    const allUtxos = await wallet.getUtxos();
    const raw = allUtxos.find(
      (u) => u.input.txHash === txHash && u.input.outputIndex === txIndex
    );
    if (!raw) { onError("UTxO data not found"); return; }

    setLoading(true);
    try {
      const txHash_ = await mintSignerToken(wallet, {
        protocolDatum,
        signerMetadataAddress,
        nickName: nickName.trim(),
        realName: realName.trim(),
        contactInfo: contactInfo.trim(),
        additionalInfo: additionalInfo.trim(),
        anchorUtxo: {
          txHash,
          txIndex,
          amount: raw.output.amount,
        },
      });
      onSuccess(txHash_);
      onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Setup Signer Identity" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl bg-violet-900/20 border border-violet-500/20 p-4 text-sm text-violet-300">
          <p className="font-medium mb-1">First-time setup</p>
          <p className="text-violet-400 text-xs leading-relaxed">
            Minting a signer token creates your on-chain identity. You'll need a single UTxO
            with ≥ 6 ADA as the anchor for the transaction input, plus a separate ADA-only
            collateral UTxO in the same wallet.
          </p>
        </div>

        <Field label="Nickname *" hint="This is your public handle and cannot be changed after minting">
          <Input
            value={nickName}
            onChange={(e) => setNickName(e.target.value)}
            placeholder="alice.ada"
          />
        </Field>

        <Field label="Real Name" hint="Optional — shown to users for trust assessment">
          <Input
            value={realName}
            onChange={(e) => setRealName(e.target.value)}
            placeholder="Alice Smith"
          />
        </Field>

        <Field label="Contact Info" hint="Optional — email, Twitter handle, etc.">
          <Input
            value={contactInfo}
            onChange={(e) => setContactInfo(e.target.value)}
            placeholder="alice@example.com"
          />
        </Field>

        <Field label="Additional Info" hint="Optional — any other public information">
          <Textarea
            value={additionalInfo}
            onChange={(e) => setAdditionalInfo(e.target.value)}
            placeholder="Security researcher at ..."
            rows={2}
          />
        </Field>

        {/* UTxO selection */}
        <Field
          label="Anchor UTxO"
          hint="Must be the only regular input. Choose a UTxO with ≥ 6 ADA and keep a separate ADA-only collateral UTxO."
        >
          <div className="flex gap-2">
            <button
              onClick={fetchUtxos}
              disabled={fetchingUtxos}
              className="px-3 py-2 rounded-lg bg-gray-800 border border-white/10 text-sm text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {fetchingUtxos ? "Loading…" : "Load UTxOs"}
            </button>
          </div>
          {utxos.length > 0 && (
            <select
              value={selectedUtxo}
              onChange={(e) => setSelectedUtxo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-white/10 text-gray-100 text-sm focus:outline-none focus:border-violet-500/60"
            >
              <option value="">Select a UTxO…</option>
              {utxos.map((u) => (
                <option key={`${u.txHash}:${u.txIndex}`} value={`${u.txHash}:${u.txIndex}`}>
                  {u.txHash.slice(0, 16)}…#{u.txIndex} — {(Number(u.lovelace) / 1e6).toFixed(2)} ADA
                </option>
              ))}
            </select>
          )}
          {utxos.length === 0 && !fetchingUtxos && (
            <p className="text-xs text-gray-500">Load UTxOs to see available inputs</p>
          )}
        </Field>

        {selectedUtxo && (
          <div className="rounded-lg bg-gray-800/60 border border-white/5 p-3">
            <p className="text-xs text-gray-400">
              Token name will be derived from this UTxO's outref and cannot be changed.
            </p>
          </div>
        )}

        <SubmitButton loading={loading} onClick={handleSubmit} disabled={!nickName || !selectedUtxo}>
          Mint Signer Token
        </SubmitButton>

        <p className="text-xs text-center text-gray-500">
          After minting,{" "}
          <a
            href={explorerTx("")}
            className="text-violet-400 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            view on explorer
          </a>
        </p>
      </div>
    </Modal>
  );
}
