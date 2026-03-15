import { useState, useCallback } from "react";
import { BrowserWallet } from "@meshsdk/core";

export interface WalletInfo {
  name: string;
  icon: string;
}

export interface ConnectedWallet {
  wallet: BrowserWallet;
  address: string;
  name: string;
}

export function useWallet() {
  const [connected, setConnected] = useState<ConnectedWallet | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [availableWallets, setAvailableWallets] = useState<WalletInfo[]>([]);

  const refreshAvailable = useCallback(async () => {
    const wallets = await BrowserWallet.getInstalledWallets();
    setAvailableWallets(wallets.map((w) => ({ name: w.name, icon: w.icon })));
    return wallets;
  }, []);

  const connect = useCallback(async (walletName: string) => {
    setConnecting(true);
    try {
      const wallet = await BrowserWallet.enable(walletName);
      const address = await wallet.getChangeAddress();
      setConnected({ wallet, address, name: walletName });
      return wallet;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setConnected(null);
  }, []);

  return { connected, connecting, availableWallets, connect, disconnect, refreshAvailable };
}
