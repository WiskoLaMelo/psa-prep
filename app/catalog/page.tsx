"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../_components/client";
import { useBusy } from "../_components/ui";

interface Stat {
  game: string;
  lang: string;
  sets: number;
  cards: number;
  updated: string | null;
}
interface Sync {
  running: boolean;
  log: string[];
  startedAt: string;
  error?: string;
}
interface Check {
  game: string;
  lang: string;
  query: string;
  expected: string;
  found: string | null;
  ok: boolean;
}

export default function CatalogPage() {
  const [stats, setStats] = useState<Stat[]>([]);
  const [sync, setSync] = useState<Sync | null>(null);
  const [check, setCheck] = useState<Check[] | null>(null);
  const { busy, err, run } = useBusy();

  const load = useCallback(() => {
    api<{ stats: Stat[]; sync: Sync | null }>("/api/catalog").then((d) => {
      setStats(d.stats);
      setSync(d.sync);
    });
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!sync?.running) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [sync?.running, load]);

  const start = (game?: "pokemon" | "onepiece", force?: boolean) =>
    run(async () => {
      await api("/api/catalog", { method: "POST", json: { game, force } });
      load();
    });

  return (
    <>
      <h1>Catalogue local</h1>
      <p className="muted">
        Pokémon : TCGdex (fr, en, ja), gratuit. One Piece : jeu de données ouvert Punk Records, généré depuis les sites officiels (fr, en) ; les cartes
        japonaises partagent leur identifiant avec l'anglais. La première synchronisation Pokémon prend quelques minutes.
      </p>
      <div className="panel" style={{ padding: 0, marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Jeu</th>
              <th>Langue</th>
              <th>Sets</th>
              <th>Cartes</th>
              <th>Mis à jour</th>
            </tr>
          </thead>
          <tbody>
            {stats.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Catalogue vide : lance une synchronisation.
                </td>
              </tr>
            )}
            {stats.map((s) => (
              <tr key={`${s.game}-${s.lang}`}>
                <td>{s.game === "onepiece" ? "One Piece" : "Pokémon"}</td>
                <td>{s.lang.toUpperCase()}</td>
                <td>{s.sets}</td>
                <td>{s.cards}</td>
                <td className="muted small">{s.updated ? new Date(s.updated).toLocaleString("fr-FR") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button className="primary" disabled={busy || sync?.running} onClick={() => start()}>
          Tout synchroniser
        </button>
        <button disabled={busy || sync?.running} onClick={() => start("pokemon")}>
          Pokémon
        </button>
        <button disabled={busy || sync?.running} onClick={() => start("onepiece")}>
          One Piece
        </button>
        <button disabled={busy || sync?.running} onClick={() => start("pokemon", true)} title="Retélécharge tous les sets">
          Pokémon (forcer)
        </button>
        <button disabled={busy} onClick={() => run(async () => setCheck((await api<{ check: Check[] }>("/api/catalog?check=1")).check))}>
          Contrôler (10 cartes par langue)
        </button>
      </div>
      {err && <p className="err">{err}</p>}
      {sync && (
        <pre className="panel small" style={{ marginTop: 16, maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap" }}>
          {sync.running ? "Synchronisation en cours…\n" : ""}
          {sync.log.join("\n")}
        </pre>
      )}
      {check && (
        <div className="panel" style={{ marginTop: 16 }}>
          <b>
            {check.filter((c) => c.ok).length}/{check.length} cartes retrouvées par code + numéro
          </b>
          <table className="small">
            <tbody>
              {check.map((c) => (
                <tr key={c.expected}>
                  <td>{c.ok ? "✓" : "✗"}</td>
                  <td>
                    {c.game}/{c.lang}
                  </td>
                  <td>{c.query}</td>
                  <td className="mono">{c.found ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
