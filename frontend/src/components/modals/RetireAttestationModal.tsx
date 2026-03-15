import { useState } from "react";
import { BrowserWallet } from "@meshsdk/core";
import { Modal, SubmitButton } from "./Modal";
import { retireAttestation } from "../../services/transactions";
import type { AttestationConstituent, AttestationUtxo, ProtocolParametersDatum } from "../../types";
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

export function RetireAttestationModal({
  wallet,
  attestation,
  protocolDatum,
  attestationValidatorAddress,
  onClose,
  onSuccess,
  onError,
}: Props) {
  const [loading, setLoading] = useState(false);

  const { signerUtxos, loading: loadingCheck } = useSignerUtxos(wallet, protocolDatum.signer_token_policy);

  // Find the constituent UTxO this user created (their author token = constituent's originalAuthor).
  // There may be more than one if the same wallet created duplicate UTxOs.
  const retirableConstituents: AttestationConstituent[] = attestation.constituents.filter((c) =>
    signerUtxos.some((s) => s.tokenName === c.originalAuthor),
  );
  const targetConstituent = retirableConstituents[0] ?? null;

  // Find the signer UTxO (author token) that matches the target constituent.
  const authorSignerUtxo = targetConstituent
    ? signerUtxos.find((s) => s.tokenName === targetConstituent.originalAuthor) ?? null
    : null;

  async function handleRetire() {
    if (!targetConstituent || !authorSignerUtxo) {
      onError("Original author token not found in wallet");
      return;
    }

    setLoading(true);
    try {
      const txHash = await retireAttestation(wallet, {
        protocolDatum,
        attestationValidatorAddress,
        attestationUtxo: {
          ...attestation,
          txHash: targetConstituent.txHash,
          txIx: targetConstituent.txIx,
          lovelace: targetConstituent.lovelace,
          signers: targetConstituent.signers,
          signerCount: targetConstituent.signers.length,
          referenceScriptHash: targetConstituent.referenceScriptHash,
        },
        signerUtxo: authorSignerUtxo,
        signerTokenName: authorSignerUtxo.tokenName,
      });
      onSuccess(txHash);
      onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const reclaimableAda = (Number(targetConstituent?.lovelace ?? attestation.lovelace) / 1e6).toFixed(2);

  return (
    <Modal title="Retire Attestation" onClose={onClose}>
      <div className="space-y-4">
        {/* Warning */}
        <div className="rounded-xl bg-red-900/20 border border-red-500/30 p-4">
          <div className="flex items-start gap-3">
            <Icons.Warning className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-300 mb-1">Irreversible action</p>
              <p className="text-xs text-red-400 leading-relaxed">
                Retiring this UTxO will burn its {targetConstituent?.signers.length ?? 0} signature token(s)
                and remove it permanently. You will reclaim ~{reclaimableAda} ADA.
              </p>
            </div>
          </div>
        </div>

        {/* Attestation info */}
        <div className="rounded-xl bg-gray-800/60 border border-white/10 p-4 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Attestation</p>
          <p className="text-sm text-gray-200">{attestation.datum.description}</p>
          <p className="text-xs font-mono text-gray-400 break-all">{attestation.datum.script_hash}</p>
          {retirableConstituents.length > 1 && (
            <p className="text-xs text-amber-400 mt-1">
              You created {retirableConstituents.length} duplicate UTxOs for this attestation.
              This will retire one — you will need to repeat for the remaining {retirableConstituents.length - 1}.
            </p>
          )}
          {targetConstituent && (
            <div className="flex items-center gap-4 pt-1 text-xs text-gray-400">
              <span>{targetConstituent.signers.length} signature(s) will be burned</span>
              <span>+{reclaimableAda} ADA reclaimed</span>
            </div>
          )}
        </div>

        {/* Author check */}
        {loadingCheck ? (
          <p className="text-sm text-gray-400">Checking author token…</p>
        ) : !targetConstituent ? (
          <div className="rounded-lg bg-amber-400/10 border border-amber-500/20 p-3 text-sm text-amber-400">
            Your wallet is not the original author of any UTxO in this attestation.
            Only the creator of each UTxO can retire it.
          </div>
        ) : (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-400">
            ✓ Author token found — you can retire this attestation
          </div>
        )}

        <SubmitButton
          loading={loading}
          onClick={handleRetire}
          disabled={!targetConstituent || loadingCheck}
        >
          Retire & Burn All Signatures
        </SubmitButton>

        <p className="text-xs text-center text-gray-500">
          <a href={explorerTx(targetConstituent?.txHash ?? attestation.txHash)} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">
            View attestation on explorer
          </a>
        </p>
      </div>
    </Modal>
  );
}
