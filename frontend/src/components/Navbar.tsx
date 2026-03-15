import { useState, useEffect } from "react";
import type { ConnectedWallet, WalletInfo } from "../hooks/useWallet";
import { LoadingSpinner } from "./LoadingSpinner";
import * as Icons from "./Icons";

interface Props {
  connected: ConnectedWallet | null;
  connecting: boolean;
  availableWallets: WalletInfo[];
  onConnect: (walletName: string) => void;
  onDisconnect: () => void;
  onRefreshWallets: () => void;
  onMintSigner: () => void;
}

function truncateAddr(addr: string) {
  if (addr.length < 20) return addr;
  return addr.slice(0, 10) + "…" + addr.slice(-6);
}

export function Navbar({
  connected,
  connecting,
  availableWallets,
  onConnect,
  onDisconnect,
  onRefreshWallets,
  onMintSigner,
}: Props) {
  const [walletOpen, setWalletOpen] = useState(false);

  useEffect(() => {
    if (walletOpen) {
      onRefreshWallets();
    }
  }, [walletOpen, onRefreshWallets]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-wallet-menu]")) {
        setWalletOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <nav className="sticky top-0 z-40 border-b border-white/5 bg-gray-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-800 flex items-center justify-center shadow-lg shadow-violet-900/40">
            <Icons.Shield className="w-5 h-5 text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight text-white">VeriScript</span>
          <span className="text-xs text-gray-500 font-mono ml-1 hidden sm:block">on-chain attestation</span>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-3">
          {connected && (
            <button
              onClick={onMintSigner}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 border border-violet-500/30 transition-all"
            >
              <Icons.Plus className="w-4 h-4" />
              Setup Signer
            </button>
          )}

          {/* Wallet menu */}
          <div className="relative" data-wallet-menu>
            {connected ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setWalletOpen(!walletOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-white/10 text-sm transition-all"
                >
                  <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
                  <span className="text-gray-200 font-mono text-xs">{truncateAddr(connected.address)}</span>
                  <Icons.ChevronDown className="w-4 h-4 text-gray-400" />
                </button>

                {walletOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-gray-900 border border-white/10 shadow-2xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-white/10">
                      <p className="text-xs text-gray-400">Connected via {connected.name}</p>
                      <p className="text-xs text-gray-500 font-mono mt-0.5 truncate">{connected.address}</p>
                    </div>
                    <button
                      onClick={() => { onDisconnect(); setWalletOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Icons.LogOut className="w-4 h-4" />
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setWalletOpen(!walletOpen)}
                  disabled={connecting}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium transition-all shadow-lg shadow-violet-900/40"
                >
                  {connecting ? (
                    <>
                      <LoadingSpinner className="w-4 h-4" />
                      Connecting…
                    </>
                  ) : (
                    <>
                      <Icons.Wallet className="w-4 h-4" />
                      Connect Wallet
                    </>
                  )}
                </button>

                {walletOpen && !connecting && (
                  <div className="absolute right-0 top-full mt-2 w-52 rounded-xl bg-gray-900 border border-white/10 shadow-2xl overflow-hidden">
                    {availableWallets.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-gray-400">No wallets detected</p>
                    ) : (
                      availableWallets.map((w) => (
                        <button
                          key={w.name}
                          onClick={() => { onConnect(w.name); setWalletOpen(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-200 hover:bg-white/5 transition-colors"
                        >
                          {w.icon ? (
                            <img src={w.icon} alt={w.name} className="w-5 h-5 rounded" />
                          ) : (
                            <div className="w-5 h-5 rounded bg-gray-700" />
                          )}
                          {w.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
