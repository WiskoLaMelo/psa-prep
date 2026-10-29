"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { NamingRules } from "@/core/psa/naming";
import { api } from "../_components/client";
import { toast, useBusy } from "../_components/ui";

interface PsaSet {
  id: number;
  game: string;
  lang: string;
  psaSetString: string;
  year: string | null;
  source: string;
  rules: NamingRules;
  items: number;
  linked: number;
  catalogSets: string;
}
interface Unlinked {
  item: { id: number; label: string; specId: string | null; exampleCert: string | null };
  set: { psaSetString: string };
  suggestions: { cardKey: string; name: string; setName: string; number: string; score: number }[];
}
interface CertResult {
  cert: string;
  status: string;
  label?: string;
  cardKey?: string | null;
  error?: string;
}

const NUMBER_FORMAT: Record<string, string> = {
  as_catalog: "comme le catalogue",
  strip_zeros: "sans zéros",
  pad3: "sur 3 chiffres",
  with_set_prefix: "avec code de set (OP05-119)",
  none: "pas de numéro",
  unknown: "?",
};
const SUBJECT_CASE: Record<string, string> = { upper: "MAJUSCULES", upper_keep_lower: "MAJUSCULES sauf suffixes (ex)", as_is: "tel quel", unknown: "?" };
const SUBJECT_SOURCE: Record<string, string> = { en: "anglais", local: "langue de la carte", unknown: "?" };

export default function MappingsPage() {
  const [sets, setSets] = useState<PsaSet[]>([]);
  const [unlinked, setUnlinked] = useState<Unlinked[]>([]);
  const [text, setText] = useState("");
  const [results, setResults] = useState<CertResult[] | null>(null);
  const [manual, setManual] = useState<Record<number, string>>({});
  const [openSet, setOpenSet] = useState<number | null>(null);
  const [setItems, setSetItems] = useState<{ id: number; label: string; title_exact: string | null; spec_id: string | null; source: string; card_key: string | null }[]>([]);
  const [hasToken, setHasToken] = useState(true);
  const { busy, err, run } = useBusy();

  const load = useCallback(() => {
    api<{ sets: PsaSet[]; unlinked: Unlinked[] }>("/api/psa").then((d) => {
      setSets(d.sets);
      setUnlinked(d.unlinked);
    });
    api<{ hasPsaToken: boolean }>("/api/config").then((c) => setHasToken(c.hasPsaToken));
  }, []);
  useEffect(load, [load]);

  const link = (psaItemId: number, cardKey: string) =>
    run(async () => {
      await api("/api/psa", { method: "POST", json: { psaItemId, cardKey } });
      toast("Relié");
      load();
    });

  const toggleSet = (id: number) => {
    if (openSet === id) return setOpenSet(null);
    setOpenSet(id);
    api<{ items: typeof setItems }>(`/api/psa?set=${id}`).then((d) => setSetItems(d.items));
  };

  return (
    <>
      <h1>Correspondances PSA</h1>
      <p className="muted">
        Chaque slab que tu possèdes donne le libellé PSA exact d'une carte. Chaque carte « Trouvée chez PSA » à la revue s'ajoute ici. Plus la base grandit,
        plus les cartes passent en vert ou en orange.
      </p>

      <h2>Importer des certificats</h2>
      <div className="panel stack">
        {!hasToken && <div className="warn">PSA_API_TOKEN manquant dans .env : l'import est impossible pour l'instant.</div>}
        <textarea rows={5} placeholder="Numéros de certificat, un par ligne (ou colle le contenu de certs.txt)" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <button
            className="primary"
            disabled={busy || !text.trim()}
            onClick={() =>
              run(async () => {
                const r = await api<{ results: CertResult[] }>("/api/certs", { method: "POST", json: { text } });
                setResults(r.results);
                load();
              })
            }
          >
            {busy ? "Import en cours (1 appel PSA toutes les ~1,5 s)…" : "Importer"}
          </button>
          <span className="muted small">Les réponses sont gardées à vie : un certificat n'est jamais redemandé. L'offre gratuite PSA est limitée à ~100 appels par jour.</span>
        </div>
        {err && <div className="err">{err}</div>}
        {results && (
          <table className="small">
            <tbody>
              {results.map((r) => (
                <tr key={r.cert}>
                  <td className="mono">{r.cert}</td>
                  <td>{{ linked: "✓ relié", cached: "✓ déjà connu", needs_link: "à relier ↓", not_found: "introuvable", error: "erreur" }[r.status] ?? r.status}</td>
                  <td>{r.label ?? r.error}</td>
                  <td className="mono">{r.cardKey}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Items PSA à relier au catalogue ({unlinked.length})</h2>
      {unlinked.length === 0 ? (
        <p className="muted small">Rien à relier.</p>
      ) : (
        <div className="stack">
          {unlinked.map((u) => (
            <div className="panel stack" key={u.item.id}>
              <div>
                <b>{u.item.label}</b> <span className="muted small">cert {u.item.exampleCert} · spec {u.item.specId}</span>
              </div>
              {u.suggestions.map((s) => (
                <div className="row small" key={s.cardKey}>
                  <button disabled={busy} onClick={() => link(u.item.id, s.cardKey)}>
                    Relier
                  </button>
                  <span>
                    {s.name} — {s.setName} #{s.number}
                  </span>
                  <span className="mono muted">{s.cardKey}</span>
                  <span className="muted">{Math.round(s.score * 100)} %</span>
                </div>
              ))}
              <div className="row small">
                <input
                  className="grow mono"
                  placeholder="ou card_key à la main : pokemon:ja:SV2a:201:base"
                  value={manual[u.item.id] ?? ""}
                  onChange={(e) => setManual({ ...manual, [u.item.id]: e.target.value })}
                />
                <button disabled={busy || !manual[u.item.id]} onClick={() => link(u.item.id, manual[u.item.id]!.trim())}>
                  Relier
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2>Sets PSA connus ({sets.length})</h2>
      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="small">
          <thead>
            <tr>
              <th>Set PSA</th>
              <th>Année</th>
              <th>Items / reliés</th>
              <th>Numéro</th>
              <th>Nom</th>
              <th>Variétés apprises</th>
              <th>Sets catalogue</th>
            </tr>
          </thead>
          <tbody>
            {sets.map((s) => (
              <Fragment key={s.id}>
                <tr onClick={() => toggleSet(s.id)} style={{ cursor: "pointer" }}>
                  <td>
                    {openSet === s.id ? "▾" : "▸"} {s.psaSetString} <span className="muted">({s.source})</span>
                  </td>
                  <td>{s.year}</td>
                  <td>
                    {s.items} / {s.linked}
                  </td>
                  <td>{NUMBER_FORMAT[s.rules.numberFormat]}</td>
                  <td>
                    {SUBJECT_SOURCE[s.rules.subjectSource]}, {SUBJECT_CASE[s.rules.subjectCase]}
                  </td>
                  <td>
                    {Object.entries(s.rules.varieties)
                      .map(([k, v]) => `${k} → ${v || "∅"}`)
                      .join(" · ")}
                  </td>
                  <td className="mono">{s.catalogSets}</td>
                </tr>
                {openSet === s.id && (
                  <tr>
                    <td colSpan={7}>
                      <table>
                        <tbody>
                          {setItems.map((i) => (
                            <tr key={i.id}>
                              <td>{i.title_exact ?? i.label}</td>
                              <td className="mono">{i.spec_id}</td>
                              <td>{i.source}</td>
                              <td className="mono">{i.card_key ?? <span className="warn">non relié</span>}</td>
                              <td>
                                {i.card_key && (
                                  <button
                                    className="small danger"
                                    onClick={() =>
                                      run(async () => {
                                        await api("/api/psa", { method: "POST", json: { cardKey: i.card_key, unlink: true } });
                                        toggleSet(s.id);
                                        load();
                                      })
                                    }
                                  >
                                    Délier
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button
          onClick={() =>
            run(async () => {
              const r = await api<{ path: string }>("/api/backup", { method: "POST" });
              toast(`Sauvegardé dans ${r.path}`);
            })
          }
        >
          Sauvegarder la base
        </button>
        <span className="muted small">data/ contient la base de correspondances, l'actif le plus précieux : sauvegarde-la régulièrement.</span>
      </div>
    </>
  );
}
