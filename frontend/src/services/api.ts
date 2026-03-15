import { API_URL } from "../config";
import type {
  AttestationUtxo,
  SignerUtxo,
  ProtocolParamsUtxo,
  BackendConfig,
} from "../types";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export const api = {
  getConfig: () => apiFetch<BackendConfig>("/api/config"),

  getProtocolParams: () => apiFetch<ProtocolParamsUtxo>("/api/protocol-parameters"),

  getAttestations: (params?: {
    scriptHash?: string;
    scriptAddress?: string;
    mintingPolicy?: string;
    page?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.scriptHash) qs.set("scriptHash", params.scriptHash);
    if (params?.scriptAddress) qs.set("scriptAddress", params.scriptAddress);
    if (params?.mintingPolicy) qs.set("mintingPolicy", params.mintingPolicy);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return apiFetch<{ attestations: AttestationUtxo[]; total: number }>(
      `/api/attestations${q ? `?${q}` : ""}`
    );
  },

  getAttestation: (txHash: string, txIx: number) =>
    apiFetch<AttestationUtxo>(`/api/attestations/${txHash}/${txIx}`),

  getSigners: (params?: { page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return apiFetch<{ signers: SignerUtxo[]; total: number }>(
      `/api/signers${q ? `?${q}` : ""}`
    );
  },

  getSigner: (policyId: string, tokenName: string) =>
    apiFetch<SignerUtxo>(`/api/signers/${policyId}/${tokenName}`),
};
