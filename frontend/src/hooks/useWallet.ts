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

interface UseWalletOptions {
  onError?: (message: string) => void;
}

// A dormant wallet extension can leave enable() pending indefinitely, which
// stranded the UI in a loading state; bound the call so failures can be retried.
const WALLET_CONNECT_TIMEOUT_MS = 3_000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function useWallet({ onError }: UseWalletOptions = {}) {
  const [connected, setConnected] = useState<ConnectedWallet | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [availableWallets, setAvailableWallets] = useState<WalletInfo[]>([]);

  const refreshAvailable = useCallback(async () => {
    const wallets = await BrowserWallet.getInstalledWallets();
    setAvailableWallets(wallets.map((w) => ({ name: w.name, icon: w.icon })));
    return wallets;
  }, []);

  const connect = useCallback(
    async (walletName: string) => {
      setConnecting(true);
      try {
        const timeoutMessage =
          "Wallet connection timed out. The wallet extension may be inactive — please try again.";
        const wallet = await withTimeout(
          BrowserWallet.enable(walletName),
          WALLET_CONNECT_TIMEOUT_MS,
          timeoutMessage,
        );
        const address = await withTimeout(
          wallet.getChangeAddress(),
          WALLET_CONNECT_TIMEOUT_MS,
          timeoutMessage,
        );
        setConnected({ wallet, address, name: walletName });
      } catch (e) {
        onError?.((e as Error).message);
      } finally {
        setConnecting(false);
      }
    },
    [onError],
  );

  const disconnect = useCallback(() => {
    setConnected(null);
  }, []);

  return {
    connected,
    connecting,
    availableWallets,
    connect,
    disconnect,
    refreshAvailable,
  };
}
