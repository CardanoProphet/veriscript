import { useState, useEffect, useCallback } from "react";
import { api } from "../services/api";
import type { AttestationUtxo, SignerUtxo, BackendConfig } from "../types";

export function useConfig() {
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { config, loading, error };
}

export function useAttestations(filter?: {
  scriptHash?: string;
  scriptAddress?: string;
  mintingPolicy?: string;
}) {
  const [attestations, setAttestations] = useState<AttestationUtxo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getAttestations({ ...filter, page, limit: 20 });
        setAttestations(data.attestations);
        setTotal(data.total);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter?.scriptHash, filter?.scriptAddress, filter?.mintingPolicy]
  );

  useEffect(() => {
    load();
  }, [load]);

  return { attestations, total, loading, error, reload: load };
}

export function useSigners() {
  const [signers, setSigners] = useState<SignerUtxo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSigners({ page, limit: 50 });
      setSigners(data.signers);
      setTotal(data.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { signers, total, loading, error, reload: load };
}
