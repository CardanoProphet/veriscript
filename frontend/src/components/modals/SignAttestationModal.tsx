import { useState, useEffect } from "react";
import { BrowserWallet } from "@meshsdk/core";
import { Modal, SubmitButton } from "./Modal";
import { signAttestation } from "../../services/transactions";
import type { AttestationUtxo, ProtocolParametersDatum, SignerUtxoInfo } from "../../types";
import { explorerTx } from "../../config";
import { useSignerUtxos } from "../../hooks/useSignerUtxos";
import * as Icons from "../Icons";

interface Props {
  wallet: BrowserWallet;
  attestation: AttestationUtxo;
  protocolDatum: ProtocolParametersDatum;
  attestationValidatorAddress: string;
  onClose: () => void;
  onSuccess: (txHash: string) => void;
  onError: (msg: string) => void;
}

export function SignAttestationModal({
  wallet,
  attestation,
  protocolDatum,
  attestationValidatorAddress,
  onClose,
  onSuccess,
  onError,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [selectedSigner, setSelectedSigner] = useState<SignerUtxoInfo | null>(null);

  const { signerUtxos, loading: loadingSigners } = useSignerUtxos(wallet, protocolDatum.signer_token_policy);

  useEffect(() => {
    if (signerUtxos.length === 1) setSelectedSigner(signerUtxos[0]);
  }, [signerUtxos]);

  // Check if already signed by this signer
  const alreadySigned = selectedSigner
    ? attestation.signers.some((s) => s.tokenName === selectedSigner.tokenName)
    : false;

  async function handleSign() {
    if (!selectedSigner) { onError("No signer token selected"); return; }
    if (alreadySigned) { onError("You have already signed this attestation"); return; }

    setLoading(true);
    try {
      const txHash = await signAttestation(wallet, {
        protocolDatum,
        attestationValidatorAddress,
        attestationUtxo: attestation,
        signerUtxo: selectedSigner,
        signerTokenName: selectedSigner.tokenName,
      });
      onSuccess(txHash);
      onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const { datum } = attestation;

  return (
    <Modal title="Sign Attestation" onClose={onClose}>
      <div className="space-y-4">
        {/* Attestation summary */}
        <div className="rounded-xl bg-gray-800/60 border border-white/10 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">You are endorsing:</h3>

          <div className="space-y-2 text-sm">
            <Row label="Description" value={datum.description} />
            <Row label="Source" value={datum.source_code} link />
            <Row label="Script Hash" value={datum.script_hash} mono />
            {datum.script_address && <Row label="Address" value={datum.script_address} mono />}
            {datum.minting_policy && <Row label="Policy ID" value={datum.minting_policy} mono />}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <Icons.Users className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-emerald-400 font-medium">
                {attestation.signerCount} signer{attestation.signerCount !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        {/* Warning */}
        <div className="rounded-lg bg-amber-400/10 border border-amber-500/20 p-3 text-xs text-amber-300 leading-relaxed">
          <strong>Important:</strong> By signing, you publicly confirm that you have verified
          the source code at the given URL compiles to the stated script hash. This is a
          permanent on-chain record.
        </div>

        {/* Signer selection */}
        <div>
          <p className="text-sm font-medium text-gray-300 mb-2">Sign with</p>
          {loadingSigners ? (
            <p className="text-sm text-gray-400">Loading signer tokens…</p>
          ) : signerUtxos.length === 0 ? (
            <div className="text-sm text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2 border border-amber-500/20">
              No signer token in wallet. Please mint your signer token first.
            </div>
          ) : (
            <select
              value={selectedSigner ? `${selectedSigner.txHash}:${selectedSigner.txIndex}` : ""}
              onChange={(e) => {
                const [th, ti] = e.target.value.split(":");
                setSelectedSigner(signerUtxos.find((s) => s.txHash === th && s.txIndex === Number(ti)) ?? null);
              }}
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-white/10 text-gray-100 text-sm focus:outline-none"
            >
              {signerUtxos.map((s) => (
                <option key={`${s.txHash}:${s.txIndex}`} value={`${s.txHash}:${s.txIndex}`}>
                  {s.tokenName.slice(0, 20)}…
                </option>
              ))}
            </select>
          )}
        </div>

        {alreadySigned && (
          <div className="text-sm text-violet-400 bg-violet-400/10 rounded-lg px-3 py-2 border border-violet-500/20">
            You have already signed this attestation.
          </div>
        )}

        <SubmitButton
          loading={loading}
          onClick={handleSign}
          disabled={!selectedSigner || signerUtxos.length === 0 || alreadySigned}
        >
          Sign Attestation
        </SubmitButton>

        <p className="text-xs text-center text-gray-500">
          <a href={explorerTx(attestation.txHash)} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">
            View attestation on explorer
          </a>
        </p>
      </div>
    </Modal>
  );
}

function Row({ label, value, mono, link }: { label: string; value: string; mono?: boolean; link?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      {link ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-400 hover:underline text-xs break-all"
        >
          {value}
        </a>
      ) : (
        <span className={`text-gray-200 text-xs break-all ${mono ? "font-mono" : ""}`}>{value}</span>
      )}
    </div>
  );
}
