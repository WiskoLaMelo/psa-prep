"use client";

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
  return data;
}

export const STATUS_LABEL = { green: "Vert — confirmé", orange: "Orange — déduit", red: "Rouge — set inconnu" } as const;

export function imageUrl(hash: string | null | undefined, w?: number) {
  return hash ? `/api/images/${hash}${w ? `?w=${w}` : ""}` : null;
}

export function formatUsd(n: number) {
  return `${n.toFixed(n < 1 ? 3 : 2)} $`;
}
