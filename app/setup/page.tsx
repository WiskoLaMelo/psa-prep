"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CardIdentity, PsaResolution } from "@/core/types";
import { api } from "../_components/client";
import { StatusPill, useBusy } from "../_components/ui";

interface Status {
  hasAnthropicKey: boolean;
  hasPsaToken: boolean;
  pokemonCards: number;
  onePieceCards: number;
}
interface Sync {
  running: boolean;
  log: string[];
  error?: string;
}
interface TestResult {
  identity: CardIdentity;
  psa: PsaResolution;
  costUsd: number;
  fromCache: boolean;
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className="panel stack" style={{ borderColor: done ? "var(--green)" : undefined }}>
      <div className="row">
        <span className={`pill ${done ? "green" : "gray"}`}>{done ? "✓ fait" : `Étape ${n}`}</span>
        <b style={{ fontSize: 16 }}>{title}</b>
      </div>
      {children}
    </div>
  );
}

export default function SetupPage() {
  const [st, setSt] = useState<Status | null>(null);
  const [sync, setSync] = useState<Sync | null>(null);
  const [key, setKey] = useState("");
  const [token, setToken] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const keyStep = useBusy();
  const tokenStep = useBusy();
  const syncStep = useBusy();
  const testStep = useBusy();

  const load = useCallback(() => {
    api<Status>("/api/setup").then(setSt);
    api<{ sync: Sync | null }>("/api/catalog").then((d) => setSync(d.sync));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!sync?.running) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [sync?.running, load]);

  if (!st) return <p className="muted">Chargement…</p>;
  const catalogReady = st.pokemonCards > 0 && st.onePieceCards > 0;
  const allDone = st.hasAnthropicKey && catalogReady;

  return (
    <>
      <h1>Premier démarrage</h1>
      <p className="muted">Quatre étapes, toutes dans cette page. Rien à taper dans un terminal.</p>
      <div className="stack" style={{ gap: 14 }}>
        <Step n={1} done={st.hasAnthropicKey} title="Ta clé Anthropic (pour lire les cartes)">
          {st.hasAnthropicKey ? (
            <span className="muted small">Clé enregistrée et vérifiée.</span>
          ) : (
            <>
              <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
                <li>
                  Ouvre{" "}
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                    console.anthropic.com → API Keys
                  </a>{" "}
                  (crée un compte si besoin, et ajoute quelques dollars de crédit dans « Billing »).
                </li>
                <li>Clique « Create Key », donne-lui un nom (par ex. « psa-prep »), puis copie la clé (elle commence par sk-ant-).</li>
                <li>Colle-la ici :</li>
              </ol>
              <div className="row">
                <input className="grow mono" type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
                <button
                  className="primary"
                  disabled={keyStep.busy || !key.trim()}
                  onClick={() =>
                    keyStep.run(async () => {
                      await api("/api/setup", { method: "POST", json: { anthropicKey: key } });
                      setKey("");
                      load();
                    })
                  }
                >
                  {keyStep.busy ? "Vérification…" : "Enregistrer"}
                </button>
              </div>
              {keyStep.err && <div className="err">{keyStep.err}</div>}
            </>
          )}
        </Step>

        <Step n={2} done={catalogReady} title="Télécharger les catalogues de cartes">
          <span className="muted small">
            Pokémon : {st.pokemonCards.toLocaleString("fr-FR")} cartes · One Piece : {st.onePieceCards.toLocaleString("fr-FR")} cartes. La première fois, compte
            quelques minutes ; tu peux laisser la page ouverte.
          </span>
          {!sync?.running ? (
            <div>
              <button
                className={catalogReady ? "" : "primary"}
                disabled={syncStep.busy}
                onClick={() =>
                  syncStep.run(async () => {
                    await api("/api/catalog", { method: "POST", json: {} });
                    load();
                  })
                }
              >
                {catalogReady ? "Mettre à jour les catalogues" : "Télécharger les catalogues"}
              </button>
            </div>
          ) : (
            <div className="warn small">Téléchargement en cours…</div>
          )}
          {sync && sync.log.length > 0 && (
            <pre className="small" style={{ maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", background: "var(--bg)", padding: 8, borderRadius: 8, margin: 0 }}>
              {sync.log.slice(-8).join("\n")}
            </pre>
          )}
          {sync?.error && <div className="err">La synchronisation a échoué : copie le texte ci-dessus et envoie-le à Claude.</div>}
          {syncStep.err && <div className="err">{syncStep.err}</div>}
        </Step>

        <Step n={3} done={Boolean(test)} title="Tester une première carte (sans caméra)">
          <span className="muted small">
            Prends en photo une carte posée à plat sur un fond sombre, vue de dessus, puis choisis la photo ici. Tu peux aussi le faire depuis le téléphone avec un
            fichier transféré sur l'ordinateur.
          </span>
          <label className={`btn ${st.hasAnthropicKey ? "primary" : ""}`} style={{ alignSelf: "flex-start", opacity: st.hasAnthropicKey ? 1 : 0.5 }}>
            {testStep.busy ? "Lecture en cours…" : "Choisir une photo"}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={!st.hasAnthropicKey || testStep.busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setPreview(URL.createObjectURL(f));
                setTest(null);
                void testStep.run(async () => {
                  const form = new FormData();
                  form.append("image", f);
                  const res = await fetch("/api/identify", { method: "POST", body: form });
                  const data = (await res.json()) as TestResult & { error?: string };
                  if (!res.ok) throw new Error(data.error ?? "Erreur");
                  setTest(data);
                });
              }}
            />
          </label>
          {!st.hasAnthropicKey && <span className="muted small">Fais d'abord l'étape 1.</span>}
          {testStep.err && <div className="err">{testStep.err}</div>}
          {(preview || test) && (
            <div className="row" style={{ alignItems: "flex-start" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {preview && <img src={preview} alt="" style={{ width: 120, borderRadius: 6 }} />}
              {test && (
                <div className="stack grow" style={{ gap: 4 }}>
                  <b style={{ fontSize: 16 }}>{test.identity.name || "Carte non reconnue"}</b>
                  <span className="small">
                    {test.identity.setName} #{test.identity.number} · {test.identity.game === "onepiece" ? "One Piece" : "Pokémon"} {test.identity.lang.toUpperCase()} ·
                    confiance {Math.round(test.identity.confidence * 100)} %
                  </span>
                  {test.identity.warnings.map((w) => (
                    <span key={w} className="warn">
                      {w}
                    </span>
                  ))}
                  <StatusPill status={test.psa.status} />
                  {test.psa.searchStrings[0] && <span className="small muted">Recherche PSA proposée : {test.psa.searchStrings[0]}</span>}
                  <span className="small muted">
                    Coût de cette lecture : {test.fromCache ? "0 $ (déjà lue)" : `≈ ${test.costUsd.toFixed(3)} $`}. Orange ou rouge est normal tant qu'aucun
                    certificat n'est importé.
                  </span>
                  <span className="small">
                    Bonne carte ? Essaie-en 2 ou 3 autres (une japonaise, une One Piece…). Mauvaise carte ? Dis-le à Claude avec la photo.
                  </span>
                </div>
              )}
            </div>
          )}
        </Step>

        <Step n={4} done={st.hasPsaToken} title="Facultatif : ton token PSA (pour importer tes slabs)">
          {st.hasPsaToken ? (
            <span className="muted small">Token enregistré. Tu peux importer tes certificats dans « Correspondances PSA ».</span>
          ) : (
            <>
              <span className="small muted">
                Sur{" "}
                <a href="https://www.psacard.com/publicapi" target="_blank" rel="noreferrer">
                  psacard.com/publicapi
                </a>
                , connecte-toi, génère un token et colle-le ici. Tu pourras le faire plus tard.
              </span>
              <div className="row">
                <input className="grow mono" type="password" placeholder="Token PSA" value={token} onChange={(e) => setToken(e.target.value)} />
                <button
                  disabled={tokenStep.busy || !token.trim()}
                  onClick={() =>
                    tokenStep.run(async () => {
                      await api("/api/setup", { method: "POST", json: { psaToken: token } });
                      setToken("");
                      load();
                    })
                  }
                >
                  Enregistrer
                </button>
              </div>
              {tokenStep.err && <div className="err">{tokenStep.err}</div>}
            </>
          )}
        </Step>
      </div>
      {allDone && (
        <div className="panel row" style={{ marginTop: 16 }}>
          <b className="grow">Tout est prêt.</b>
          <Link className="btn primary" href="/">
            Commencer une session de scan →
          </Link>
        </div>
      )}
    </>
  );
}
