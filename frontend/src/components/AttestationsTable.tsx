import { useState } from "react";
import type { AttestationUtxo, SignerUtxo } from "../types";
import { explorerTx } from "../config";
import { hexToUtf8 } from "../utils/hex";
import { LoadingSpinner } from "./LoadingSpinner";
import * as Icons from "./Icons";

interface Props {
  attestations: AttestationUtxo[];
  signers: SignerUtxo[];
  loading: boolean;
  total: number;
  isConnected: boolean;
  onSign: (a: AttestationUtxo) => void;
  onRetire: (a: AttestationUtxo) => void;
  onCreateNew: () => void;
  onFilterChange: (f: { scriptHash: string; scriptAddress: string; mintingPolicy: string }) => void;
}

function Badge({ count }: { count: number }) {
  const color = count === 0 ? "text-gray-400 bg-gray-800" : count === 1 ? "text-amber-300 bg-amber-900/30 border-amber-700/40" : "text-emerald-300 bg-emerald-900/30 border-emerald-700/40";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${color}`}>
      <Icons.Shield className="w-3 h-3" />
      {count}
    </span>
  );
}

function SignerTag({ tokenName, signers }: { tokenName: string; signers: SignerUtxo[] }) {
  const signer = signers.find((s) => s.tokenName === tokenName);
  const label = signer ? signer.metadata.nick_name : tokenName.slice(0, 8) + "…";
  return (
    <span className="inline-block px-1.5 py-0.5 rounded bg-gray-700/60 text-gray-300 text-xs font-mono border border-white/5">
      {label}
    </span>
  );
}

function AttestationRow({
  attestation,
  signers,
  isConnected,
  onSign,
  onRetire,
}: {
  attestation: AttestationUtxo;
  signers: SignerUtxo[];
  isConnected: boolean;
  onSign: () => void;
  onRetire: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { datum } = attestation;

  return (
    <>
      <tr
        className="border-b border-white/5 hover:bg-white/[0.02] transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-gray-100 font-medium line-clamp-1">{datum.description}</span>
            <span className="text-xs text-gray-500 font-mono">{datum.script_hash.slice(0, 20)}…</span>
          </div>
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          <a
            href={datum.source_code}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-violet-400 hover:underline line-clamp-1 max-w-[200px] block"
          >
            {datum.source_code.replace(/^https?:\/\//, "")}
          </a>
        </td>
        <td className="px-4 py-3">
          <Badge count={attestation.signerCount} />
        </td>
        <td className="px-4 py-3 text-xs text-gray-400 font-mono hidden lg:table-cell">
          {attestation.referenceScriptHash ? (
            <span className="text-emerald-400">✓ attached</span>
          ) : (
            <span className="text-gray-600">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
            <a
              href={explorerTx(attestation.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-gray-500 hover:text-violet-400 hover:bg-violet-400/10 transition-colors"
              title="View on explorer"
            >
              <Icons.ExternalLink className="w-4 h-4" />
            </a>
            {isConnected && (
              <>
                <button
                  onClick={onSign}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-emerald-400 hover:bg-emerald-400/10 transition-colors"
                  title="Sign attestation"
                >
                  <Icons.Pen className="w-4 h-4" />
                </button>
                <button
                  onClick={onRetire}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  title="Retire attestation"
                >
                  <Icons.Trash className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-white/5 bg-gray-900/50">
          <td colSpan={5} className="px-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2">
                <DetailRow label="Script Hash" value={datum.script_hash} mono />
                {datum.script_address && <DetailRow label="Address" value={datum.script_address} mono />}
                {datum.minting_policy && <DetailRow label="Minting Policy" value={datum.minting_policy} mono />}
                {datum.staking_policy && <DetailRow label="Staking Policy" value={datum.staking_policy} mono />}
                <DetailRow label="Original Author" value={datum.original_author.slice(0, 32) + "…"} mono />
              </div>
              <div className="space-y-2">
                <p className="text-gray-400 font-medium uppercase tracking-wide">Signers</p>
                <div className="flex flex-wrap gap-1.5">
                  {attestation.signers.map((s) => (
                    <SignerTag key={s.tokenName} tokenName={s.tokenName} signers={signers} />
                  ))}
                  {attestation.signers.length === 0 && (
                    <span className="text-gray-500">No signers yet</span>
                  )}
                </div>
                <p className="text-gray-400 font-medium uppercase tracking-wide mt-3">Source</p>
                <a
                  href={datum.source_code}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-400 hover:underline break-all"
                >
                  {datum.source_code}
                </a>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-gray-500 uppercase tracking-wide text-[10px]">{label}</span>
      <p className={`text-gray-200 break-all ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

export function AttestationsTable({
  attestations,
  signers,
  loading,
  total,
  isConnected,
  onSign,
  onRetire,
  onCreateNew,
  onFilterChange,
}: Props) {
  const [scriptHash, setScriptHash] = useState("");
  const [scriptAddress, setScriptAddress] = useState("");
  const [mintingPolicy, setMintingPolicy] = useState("");

  function applyFilter() {
    onFilterChange({ scriptHash, scriptAddress, mintingPolicy });
  }

  function clearFilter() {
    setScriptHash("");
    setScriptAddress("");
    setMintingPolicy("");
    onFilterChange({ scriptHash: "", scriptAddress: "", mintingPolicy: "" });
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={scriptHash}
            onChange={(e) => setScriptHash(e.target.value)}
            placeholder="Filter by script hash…"
            className="px-3 py-2 rounded-lg bg-gray-900 border border-white/10 text-gray-200 placeholder-gray-500 text-sm focus:outline-none focus:border-violet-500/60 font-mono"
          />
          <input
            value={scriptAddress}
            onChange={(e) => setScriptAddress(e.target.value)}
            placeholder="Filter by address…"
            className="px-3 py-2 rounded-lg bg-gray-900 border border-white/10 text-gray-200 placeholder-gray-500 text-sm focus:outline-none focus:border-violet-500/60"
          />
          <input
            value={mintingPolicy}
            onChange={(e) => setMintingPolicy(e.target.value)}
            placeholder="Filter by minting policy…"
            className="px-3 py-2 rounded-lg bg-gray-900 border border-white/10 text-gray-200 placeholder-gray-500 text-sm focus:outline-none focus:border-violet-500/60 font-mono"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={applyFilter}
            className="px-4 py-2 rounded-lg bg-gray-800 border border-white/10 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
          >
            Search
          </button>
          <button
            onClick={clearFilter}
            className="px-3 py-2 rounded-lg text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            Clear
          </button>
          {isConnected && (
            <button
              onClick={onCreateNew}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all shadow-lg shadow-violet-900/30"
            >
              <Icons.Plus className="w-4 h-4" />
              New Attestation
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-gray-900/50">
          <span className="text-sm text-gray-400">
            {loading ? "Loading…" : `${total} attestation${total !== 1 ? "s" : ""}`}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <LoadingSpinner />
              <p className="text-sm text-gray-400">Fetching attestations…</p>
            </div>
          </div>
        ) : attestations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Icons.Document className="w-12 h-12 text-gray-700" />
            <p className="text-gray-400 text-sm">No attestations found</p>
            {isConnected && (
              <button onClick={onCreateNew} className="text-violet-400 hover:underline text-sm">
                Create the first one
              </button>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-gray-900/30">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Script</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide hidden md:table-cell">Source</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Signers</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide hidden lg:table-cell">Ref Script</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {attestations.map((a) => (
                <AttestationRow
                  key={`${a.txHash}#${a.txIx}`}
                  attestation={a}
                  signers={signers}
                  isConnected={isConnected}
                  onSign={() => onSign(a)}
                  onRetire={() => onRetire(a)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export { hexToUtf8 };
