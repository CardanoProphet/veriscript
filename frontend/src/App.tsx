import { useState, useCallback } from "react";
import { Navbar } from "./components/Navbar";
import { AttestationsTable } from "./components/AttestationsTable";
import { SignersGrid } from "./components/SignersGrid";
import { ToastContainer } from "./components/Toast";
import { MintSignerTokenModal } from "./components/modals/MintSignerTokenModal";
import { CreateAttestationModal } from "./components/modals/CreateAttestationModal";
import { SignAttestationModal } from "./components/modals/SignAttestationModal";
import { RetireAttestationModal } from "./components/modals/RetireAttestationModal";
import { useWallet } from "./hooks/useWallet";
import { useAttestations, useSigners, useConfig } from "./hooks/useAttestations";
import type { AttestationUtxo, Toast } from "./types";

type Modal =
  | { type: "mintSigner" }
  | { type: "createAttestation" }
  | { type: "signAttestation"; attestation: AttestationUtxo }
  | { type: "retireAttestation"; attestation: AttestationUtxo }
  | null;

type Tab = "attestations" | "signers";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("attestations");
  const [modal, setModal] = useState<Modal>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [filter, setFilter] = useState({ scriptHash: "", scriptAddress: "", mintingPolicy: "" });

  const { connected, connecting, availableWallets, connect, disconnect, refreshAvailable } = useWallet();
  const { config, loading: configLoading } = useConfig();
  const { attestations, total, loading: attLoading, reload: reloadAtt } = useAttestations(
    filter.scriptHash || filter.scriptAddress || filter.mintingPolicy ? filter : undefined
  );
  const { signers, loading: signersLoading } = useSigners();

  // ── Toasts ────────────────────────────────────────────────────────────────

  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  function onSuccess(txHash: string) {
    addToast("success", `Transaction submitted! Hash: ${txHash.slice(0, 16)}…`);
    setTimeout(() => reloadAtt(), 3000);
  }

  function onError(msg: string) {
    addToast("error", msg);
  }

  // ── Protocol datum derived from backend config ────────────────────────────

  const protocolDatum = config?.hashes
    ? {
        signer_token_policy: config.hashes.signer_token_policy,
        signer_metadata_validator: config.hashes.signer_metadata_validator,
        signature_token_policy: config.hashes.signature_token_policy,
        attestation_validator: config.hashes.attestation_validator,
      }
    : null;

  const attestationValidatorAddress = config?.addresses.attestation_validator ?? "";
  const signerMetadataAddress = config?.addresses.signer_metadata_validator ?? "";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950">
      <Navbar
        connected={connected}
        connecting={connecting}
        availableWallets={availableWallets}
        onConnect={connect}
        onDisconnect={disconnect}
        onRefreshWallets={refreshAvailable}
        onMintSigner={() => setModal({ type: "mintSigner" })}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">On-chain Script Attestation</h1>
          <p className="text-gray-400 text-sm">
            Verify Cardano smart contracts via signed, on-chain attestations from identifiable signers.
          </p>
          {config && !configLoading && (
            <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-800 border border-white/10 text-xs text-gray-400">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {config.network.toUpperCase()}
            </div>
          )}
        </div>

        {/* Stats */}
        {!attLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total Attestations" value={total} />
            <StatCard label="Registered Signers" value={signers.length} />
            <StatCard label="Multi-signed" value={attestations.filter((a) => a.signerCount > 1).length} />
            <StatCard label="With Ref Scripts" value={attestations.filter((a) => a.referenceScriptHash).length} />
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 bg-gray-900 rounded-xl p-1 w-fit border border-white/10">
          {(["attestations", "signers"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                activeTab === tab
                  ? "bg-violet-600 text-white shadow-lg shadow-violet-900/30"
                  : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === "attestations" ? (
          <AttestationsTable
            attestations={attestations}
            signers={signers}
            loading={attLoading}
            total={total}
            isConnected={!!connected}
            onSign={(a) => setModal({ type: "signAttestation", attestation: a })}
            onRetire={(a) => setModal({ type: "retireAttestation", attestation: a })}
            onCreateNew={() => setModal({ type: "createAttestation" })}
            onFilterChange={setFilter}
          />
        ) : (
          <SignersGrid signers={signers} loading={signersLoading} />
        )}
      </main>

      {/* Modals */}
      {modal?.type === "mintSigner" && connected && protocolDatum && (
        <MintSignerTokenModal
          wallet={connected.wallet}
          protocolDatum={protocolDatum}
          signerMetadataAddress={signerMetadataAddress}
          onClose={() => setModal(null)}
          onSuccess={onSuccess}
          onError={onError}
        />
      )}

      {modal?.type === "createAttestation" && connected && protocolDatum && (
        <CreateAttestationModal
          wallet={connected.wallet}
          protocolDatum={protocolDatum}
          attestationValidatorAddress={attestationValidatorAddress}
          onClose={() => setModal(null)}
          onSuccess={onSuccess}
          onError={onError}
        />
      )}

      {modal?.type === "signAttestation" && connected && protocolDatum && (
        <SignAttestationModal
          wallet={connected.wallet}
          attestation={modal.attestation}
          protocolDatum={protocolDatum}
          attestationValidatorAddress={attestationValidatorAddress}
          onClose={() => setModal(null)}
          onSuccess={onSuccess}
          onError={onError}
        />
      )}

      {modal?.type === "retireAttestation" && connected && protocolDatum && (
        <RetireAttestationModal
          wallet={connected.wallet}
          attestation={modal.attestation}
          protocolDatum={protocolDatum}
          attestationValidatorAddress={attestationValidatorAddress}
          onClose={() => setModal(null)}
          onSuccess={onSuccess}
          onError={onError}
        />
      )}

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-gray-900 border border-white/10 px-4 py-3">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}
