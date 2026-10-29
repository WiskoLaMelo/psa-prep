"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import type { SessionItemView } from "@/core/session/service";
import { api, formatUsd } from "../../_components/client";
import { ItemCard } from "../../_components/ItemCard";
import { useBusy } from "../../_components/ui";

interface Data {
  session: { id: string; name: string; status: string };
  items: SessionItemView[];
  cost: { calls: number; cost: number };
  pending: number;
}

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [todoOnly, setTodoOnly] = useState(false);
  const [name, setName] = useState("");
  const { busy, err, run } = useBusy();

  const load = useCallback(() => {
    api<Data>(`/api/sessions/${id}`)
      .then((d) => {
        setData(d);
        setName((n) => n || d.session.name);
      })
      .catch(() => {});
  }, [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return <p className="muted">Chargement…</p>;
  const items = data.items;
  const count = (s: string | null) => items.filter((i) => (i.psa?.status ?? null) === s).length;
  const errors = items.filter((i) => i.captureStatus === "error").length;
  const shown = todoOnly ? items.filter((i) => i.psa?.status !== "green" || (i.identity?.confidence ?? 0) < 0.9) : items;
  const totalValue = items.reduce((s, i) => s + (i.declaredValue ?? 0), 0);

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== data.session.name && run(() => api(`/api/sessions/${id}`, { method: "PATCH", json: { name } }))}
          style={{ fontSize: 20, fontWeight: 700, background: "transparent", border: "none", padding: 0 }}
          className="grow"
        />
        <Link className="btn" href={`/scan/${id}`}>
          Continuer le scan
        </Link>
      </div>
      <div className="panel row" style={{ marginBottom: 16, position: "sticky", top: 52, zIndex: 5 }}>
        <span>
          <b>{items.length}</b> cartes
        </span>
        <span className="pill green">{count("green")} verts</span>
        <span className="pill orange">{count("orange")} oranges</span>
        <span className="pill red">{count("red")} rouges</span>
        {count(null) > 0 && <span className="pill gray">{count(null)} à identifier</span>}
        {data.pending > 0 && <span className="muted small">{data.pending} en cours…</span>}
        <span className="muted small">
          {data.cost.calls} lectures · {formatUsd(data.cost.cost)} · valeur déclarée {totalValue} $
        </span>
        <span className="grow" />
        <label className="row small">
          <input type="checkbox" checked={todoOnly} onChange={(e) => setTodoOnly(e.target.checked)} /> À traiter seulement
        </label>
        {errors > 0 && (
          <button disabled={busy} onClick={() => run(async () => { await api(`/api/sessions/${id}/retry`, { method: "POST", json: {} }); load(); })}>
            Relancer {errors} erreur{errors > 1 ? "s" : ""}
          </button>
        )}
        <a className="btn" href={`/api/sessions/${id}/export?format=csv`}>
          CSV
        </a>
        <a className="btn" href={`/api/sessions/${id}/export?format=json`}>
          JSON
        </a>
        <Link className="btn" href={`/print/${id}`}>
          Imprimer
        </Link>
      </div>
      {err && <p className="err">{err}</p>}
      {shown.length === 0 && <p className="muted">{items.length ? "Rien à traiter : toutes les cartes sont vertes et sûres." : "Aucune carte. Passe par le scan."}</p>}
      <div className="stack" style={{ gap: 12 }}>
        {shown.map((i) => (
          <ItemCard key={`${i.id}-${i.position}`} item={i} sessionId={id} total={items.length} onChange={load} />
        ))}
      </div>
    </>
  );
}
