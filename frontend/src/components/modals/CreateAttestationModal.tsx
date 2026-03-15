import { useState, useEffect } from "react";
import { BrowserWallet } from "@meshsdk/core";
import { Modal, Field, Input, Textarea, SubmitButton } from "./Modal";
import { createAttestation } from "../../services/transactions";
import type { ProtocolParametersDatum } from "../../types";
import { explorerTx } from "../../config";
import { useSignerUtxos } from "../../hooks/useSignerUtxos";
import type { SignerUtxoInfo } from "../../types";

interface Props {
  wallet: BrowserWallet;
  protocolDatum: ProtocolParametersDatum;
  attestationValidatorAddress: string;
  onClose: () => void;
  onSuccess: (txHash: string) => void;
  onError: (msg: string) => void;
}

function validateHexField(
  value: string,
  label: string,
  expectedLength?: number,
): string | null {
  if (value === "") return null;
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    return `${label} must be valid hex`;
  }
  if (expectedLength !== undefined && value.length !== expectedLength) {
    return `${label} must be ${expectedLength} hex characters`;
  }
  return null;
}

export function CreateAttestationModal({
  wallet,
  protocolDatum,
  attestationValidatorAddress,
  onClose,
  onSuccess,
  onError,
}: Props) {
  const [description, setDescription] = useState("");
  const [sourceCode, setSourceCode] = useState("");
  const [scriptHash, setScriptHash] = useState("");
  const [scriptAddress, setScriptAddress] = useState("");
  const [stakingPolicy, setStakingPolicy] = useState("");
  const [mintingPolicy, setMintingPolicy] = useState("");
  const [referencedScript, setReferencedScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedSigner, setSelectedSigner] = useState<SignerUtxoInfo | null>(null);

  const { signerUtxos, loading: loadingSigners } = useSignerUtxos(wallet, protocolDatum.signer_token_policy);

  useEffect(() => {
    if (signerUtxos.length === 1) setSelectedSigner(signerUtxos[0]);
  }, [signerUtxos]);

  function validate() {
    if (!description.trim()) return "Description is required";
    if (!sourceCode.trim()) return "Source code URL is required";
    const normalizedScriptHash = scriptHash.trim();
    if (!normalizedScriptHash) return "Script hash is required";

    const hexChecks: [string, string, number?][] = [
      [normalizedScriptHash, "Script hash", 56],
      [stakingPolicy.trim(), "Staking policy ID", 56],
      [mintingPolicy.trim(), "Minting policy ID", 56],
      [referencedScript.trim(), "Reference script CBOR"],
    ];
    for (const [value, label, len] of hexChecks) {
      const err = validateHexField(value, label, len);
      if (err) return err;
    }

    if (!scriptAddress.trim() && !stakingPolicy.trim() && !mintingPolicy.trim())
      return "At least one of script address, staking policy, or minting policy is required";
    if (!selectedSigner) return "No signer token found in wallet";
    return null;
  }

  async function handleSubmit() {
    const err = validate();
    if (err) { onError(err); return; }

    setLoading(true);
    try {
      const txHash = await createAttestation(wallet, {
        protocolDatum,
        attestationValidatorAddress,
        signerUtxo: selectedSigner!,
        signerTokenName: selectedSigner!.tokenName,
        description: description.trim(),
        sourceCode: sourceCode.trim(),
        scriptHash: scriptHash.trim().toLowerCase(),
        scriptAddress: scriptAddress.trim(),
        stakingPolicy: stakingPolicy.trim().toLowerCase(),
        mintingPolicy: mintingPolicy.trim().toLowerCase(),
        referencedScriptCbor: referencedScript.trim() || undefined,
      });
      onSuccess(txHash);
      onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Create Attestation" onClose={onClose} wide>
      <div className="space-y-4">
        {/* Signer selection */}
        <div className="rounded-xl bg-gray-800/60 border border-white/10 p-4">
          <p className="text-sm font-medium text-gray-300 mb-2">Signing as</p>
          {loadingSigners ? (
            <p className="text-sm text-gray-400">Loading signer tokens…</p>
          ) : signerUtxos.length === 0 ? (
            <div className="text-sm text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2 border border-amber-500/20">
              No signer token found in wallet. Please mint your signer token first.
            </div>
          ) : (
            <select
              value={selectedSigner ? `${selectedSigner.txHash}:${selectedSigner.txIndex}` : ""}
              onChange={(e) => {
                const [th, ti] = e.target.value.split(":");
                setSelectedSigner(signerUtxos.find((s) => s.txHash === th && s.txIndex === Number(ti)) ?? null);
              }}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-white/10 text-gray-100 text-sm focus:outline-none"
            >
              {signerUtxos.map((s) => (
                <option key={`${s.txHash}:${s.txIndex}`} value={`${s.txHash}:${s.txIndex}`}>
                  Token: {s.tokenName.slice(0, 20)}… (#{s.txIndex})
                </option>
              ))}
            </select>
          )}
          {selectedSigner && (
            <p className="text-xs text-gray-500 mt-1.5">
              This UTxO will be the only regular input. Keep a separate ADA-only collateral UTxO
              in the wallet as well.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Field label="Description *" hint="Human-readable description of the script">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="VeriScript attestation validator — validates attestation UTxO transitions"
              rows={2}
            />
          </Field>

          <Field label="Source Code URL *" hint="Link to the exact commit (e.g. GitHub permalink)">
            <Input
              value={sourceCode}
              onChange={(e) => setSourceCode(e.target.value)}
              placeholder="https://github.com/org/repo/tree/abc123def..."
            />
          </Field>

          <Field label="Script Hash *" hint="Hex-encoded hash of the compiled script">
            <Input
              value={scriptHash}
              onChange={(e) => setScriptHash(e.target.value)}
              placeholder="2a90ced777411f61380dda13e5372173082496bb3e0e31f3e23577aa"
              className="font-mono text-xs"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Script Address" hint="Bech32 address (if spending script)">
              <Input
                value={scriptAddress}
                onChange={(e) => setScriptAddress(e.target.value)}
                placeholder="addr_test1..."
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Staking Policy ID" hint="Hex (if staking script)">
              <Input
                value={stakingPolicy}
                onChange={(e) => setStakingPolicy(e.target.value)}
                placeholder="hex policy id"
                className="font-mono text-xs"
              />
            </Field>
          </div>

          <Field label="Minting Policy ID" hint="Hex (if minting policy)">
            <Input
              value={mintingPolicy}
              onChange={(e) => setMintingPolicy(e.target.value)}
              placeholder="hex policy id"
              className="font-mono text-xs"
            />
          </Field>

          <Field
            label="Reference Script CBOR"
            hint="Optional: hex-encoded CBOR of the script binary to attach on-chain"
          >
            <Textarea
              value={referencedScript}
              onChange={(e) => setReferencedScript(e.target.value)}
              placeholder="5909d101..."
              rows={3}
              className="font-mono text-xs"
            />
          </Field>
        </div>

        <SubmitButton
          loading={loading}
          onClick={handleSubmit}
          disabled={!selectedSigner || signerUtxos.length === 0}
        >
          Create Attestation
        </SubmitButton>

        {loading && (
          <p className="text-xs text-center text-gray-400">
            Building transaction — please check your wallet…
          </p>
        )}
      </div>
    </Modal>
  );
}

// Re-export for external use
export type { Props as CreateAttestationModalProps };
export { explorerTx };
