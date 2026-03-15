import type { SignerUtxo } from "../types";
import { explorerTx } from "../config";
import { LoadingSpinner } from "./LoadingSpinner";
import * as Icons from "./Icons";

interface Props {
  signers: SignerUtxo[];
  loading: boolean;
}

function SignerCard({ signer }: { signer: SignerUtxo }) {
  const { metadata } = signer;
  const initials = metadata.nick_name.slice(0, 2).toUpperCase();

  return (
    <div className="rounded-xl bg-gray-900 border border-white/10 p-5 flex flex-col gap-4 hover:border-violet-500/30 hover:bg-gray-900/80 transition-all">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-600 to-purple-800 flex items-center justify-center text-sm font-bold text-white shadow-lg shadow-violet-900/30 shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{metadata.nick_name}</p>
          {metadata.real_name && (
            <p className="text-xs text-gray-400 truncate">{metadata.real_name}</p>
          )}
        </div>
        <a
          href={explorerTx(signer.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-gray-600 hover:text-violet-400 transition-colors shrink-0"
          title="View on explorer"
        >
          <Icons.ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {metadata.contact_info && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Icons.Mail className="w-4 h-4 shrink-0" />
          <span className="truncate">{metadata.contact_info}</span>
        </div>
      )}

      {metadata.additional_info && (
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
          {metadata.additional_info}
        </p>
      )}

      <div className="mt-auto pt-2 border-t border-white/5 flex items-center justify-between">
        <span className="text-xs text-gray-600 font-mono">{signer.tokenName.slice(0, 16)}…</span>
        <span className="text-xs text-gray-500">{(Number(signer.lovelace) / 1e6).toFixed(2)} ADA</span>
      </div>
    </div>
  );
}

export function SignersGrid({ signers, loading }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <LoadingSpinner />
          <p className="text-sm text-gray-400">Loading signers…</p>
        </div>
      </div>
    );
  }

  if (signers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Icons.Users className="w-12 h-12 text-gray-700" />
        <p className="text-gray-400 text-sm">No signers registered yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {signers.map((s) => (
        <SignerCard key={s.tokenName} signer={s} />
      ))}
    </div>
  );
}
