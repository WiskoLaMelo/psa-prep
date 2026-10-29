"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, formatUsd } from "./_components/client";
import { useBusy } from "./_components/ui";

interface SessionRow {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  items: number;
  green: number;
  orange: number;
  red: number;
  pending: number;
}
interface Config {
  hasAnthropicKey: boolean;
  hasPsaToken: boolean;
  model: string;
  totals: { calls: number; cost: number };
}

export default function Home() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [name, setName] = useState("");
  const { busy, err, run } = useBusy();

  const load = () => {
    api<SessionRow[]>("/api/sessions").then(setSessions).catch(() => setSessions([]));
    api<Config>("/api/config").then(setCfg).catch(() => {});
  };
  useEffect(load, []);
  // Premier lancement : pas de clé ou catalogue vide → page de démarrage guidé.
  useEffect(() => {
    api<{ hasAnthropicKey: boolean; pokemonCards: number; onePieceCards: number }>("/api/setup")
      .then((s) => {
        if (!s.hasAnthropicKey || (s.pokemonCards === 0 && s.onePieceCards === 0)) location.replace("/setup");
      })
      .catch(() => {});
  }, []);

  const create = () =>
    run(async () => {
      const s = await api<{ id: string }>("/api/sessions", { method: "POST", json: { name } });
      location.href = `/scan/${s.id}`;
    });

  const remove = (s: SessionRow) =>
    run(async () => {
      if (!confirm(`Supprimer la session « ${s.name} » et ses ${s.items} cartes ?`)) return;
      await api(`/api/sessions/${s.id}`, { method: "DELETE" });
      load();
    });

  return (
    <>
      <h1>Sessions de submission</h1>
      {cfg && (!cfg.hasAnthropicKey || !cfg.hasPsaToken) && (
        <div className="panel warn" style={{ marginBottom: 16 }}>
          {!cfg.hasAnthropicKey && <div>ANTHROPIC_API_KEY absent de .env : la lecture des cartes ne fonctionnera pas.</div>}
          {!cfg.hasPsaToken && <div>PSA_API_TOKEN absent de .env : l'import des certificats est désactivé.</div>}
        </div>
      )}
      <div className="panel row" style={{ marginBottom: 20 }}>
        <input className="grow" placeholder="Nom de la submission (ex. Bulk JP novembre)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        <button className="primary" onClick={create} disabled={busy}>
          Nouvelle session et scanner
        </button>
      </div>
      {err && <p className="err">{err}</p>}
      {sessions === null ? (
        <p className="muted">Chargement…</p>
      ) : sessions.length === 0 ? (
        <p className="muted">Aucune session pour l'instant. Une session = une submission PSA.</p>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Cartes</th>
                <th>Statuts</th>
                <th>Créée le</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/review/${s.id}`}>{s.name}</Link>
                  </td>
                  <td>
                    {s.items}
                    {s.pending > 0 && <span className="muted small"> ({s.pending} en cours)</span>}
                  </td>
                  <td className="row">
                    {s.green > 0 && <span className="pill green">{s.green}</span>}
                    {s.orange > 0 && <span className="pill orange">{s.orange}</span>}
                    {s.red > 0 && <span className="pill red">{s.red}</span>}
                  </td>
                  <td className="muted small">{new Date(s.createdAt).toLocaleString("fr-FR")}</td>
                  <td className="row" style={{ justifyContent: "flex-end" }}>
                    <Link className="btn" href={`/scan/${s.id}`}>
                      Scanner
                    </Link>
                    <Link className="btn" href={`/review/${s.id}`}>
                      Revue
                    </Link>
                    <button className="danger icon" onClick={() => remove(s)} title="Supprimer">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cfg && (
        <p className="muted small" style={{ marginTop: 20 }}>
          Lecture : {cfg.model} · {cfg.totals.calls} cartes lues au total, {formatUsd(cfg.totals.cost)} estimés.
        </p>
      )}
    </>
  );
}
