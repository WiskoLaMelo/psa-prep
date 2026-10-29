"use client";

import { useEffect, useState } from "react";
import type { SessionItemView } from "@/core/session/service";
import type { CardIdentity, ManualFields } from "@/core/types";
import { api, imageUrl } from "./client";
import { Copyable, Lightbox, StatusPill, copyText, toast, useBusy } from "./ui";

const FIELD_LABELS: Record<keyof ManualFields, string> = { year: "Année", brand: "Set / marque PSA", number: "Numéro", subject: "Nom (sujet)", variety: "Variété" };

type IdentityEdit = Pick<CardIdentity, "game" | "lang" | "setId" | "setName" | "number" | "name" | "nameEn" | "variant">;

export function ItemCard({ item, sessionId, total, onChange }: { item: SessionItemView; sessionId: string; total: number; onChange: () => void }) {
  const { busy, err, run } = useBusy();
  const [zoom, setZoom] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<IdentityEdit | null>(null);
  const [overrides, setOverrides] = useState<Partial<ManualFields>>(item.manualOverrides ?? {});
  const [value, setValue] = useState(item.declaredValue?.toString() ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [found, setFound] = useState("");
  const [specId, setSpecId] = useState("");
  const [usedSearch, setUsedSearch] = useState("");

  useEffect(() => setOverrides(item.manualOverrides ?? {}), [item.manualOverrides]);

  const id = item.identity;
  const psa = item.psa;
  const url = `/api/sessions/${sessionId}/items/${item.id}`;
  const patch = (body: unknown) =>
    run(async () => {
      await api(url, { method: "PATCH", json: body });
      onChange();
    });

  const startEdit = () => {
    setEdit({
      game: id?.game ?? "pokemon",
      lang: id?.lang ?? "fr",
      setId: id?.setId ?? "",
      setName: id?.setName ?? "",
      number: id?.number ?? "",
      name: id?.name ?? "",
      nameEn: id?.nameEn ?? "",
      variant: id?.variant ?? "base",
    });
    setEditing(true);
  };

  const confirmFound = () =>
    run(async () => {
      await api(`${url}/found`, { method: "POST", json: { title: found, specId, searchPattern: usedSearch || undefined } });
      setFound("");
      setSpecId("");
      toast("Correspondance confirmée : elle servira aux prochaines cartes");
      onChange();
    });

  const fields = psa?.manualFields;

  return (
    <div className="panel item" id={`item-${item.position}`}>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="pos">{item.position}</span>
          <span className="row" style={{ gap: 4 }}>
            <button className="icon" title="Monter" disabled={item.position === 1 || busy} onClick={() => patch({ position: item.position - 1 })}>
              ↑
            </button>
            <button className="icon" title="Descendre" disabled={item.position === total || busy} onClick={() => patch({ position: item.position + 1 })}>
              ↓
            </button>
          </span>
        </div>
        {item.frontImageHash && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb" src={imageUrl(item.frontImageHash, 240)!} alt="" onClick={() => setZoom(imageUrl(item.frontImageHash)!)} />
        )}
        {item.backImageHash && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb" src={imageUrl(item.backImageHash, 240)!} alt="verso" onClick={() => setZoom(imageUrl(item.backImageHash)!)} style={{ width: 60 }} />
        )}
        {id?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={id.imageUrl} alt="" title="Image du catalogue" onError={(e) => (e.currentTarget.style.display = "none")} style={{ width: 60, borderRadius: 4, opacity: 0.9 }} onClick={() => setZoom(id.imageUrl!)} />
        )}
        <button
          className="danger small"
          onClick={() =>
            run(async () => {
              if (!confirm(`Supprimer la carte ${item.position} ?`)) return;
              await api(url, { method: "DELETE" });
              onChange();
            })
          }
        >
          Supprimer
        </button>
      </div>

      <div className="stack">
        <div className="row">
          <StatusPill status={psa?.status} />
          {id && (
            <span className={`small ${id.confidence < 0.9 ? "warn" : "muted"}`}>
              confiance {Math.round(id.confidence * 100)} %{id.method === "manual" ? " (corrigée)" : ""}
            </span>
          )}
          {item.duplicateOf.length > 0 && <span className="warn">Doublon de la carte {item.duplicateOf.join(", ")}</span>}
          {(item.captureStatus === "pending" || item.captureStatus === "processing") && <span className="muted small">Identification en cours…</span>}
          {item.captureStatus === "error" && (
            <span className="err">
              {item.captureError}{" "}
              <button className="small" onClick={() => run(async () => { await api(`/api/sessions/${sessionId}/retry`, { method: "POST", json: { captureId: item.frontCaptureId } }); onChange(); })}>
                Réessayer
              </button>
            </span>
          )}
        </div>

        {id && !editing && (
          <div className="row" style={{ alignItems: "baseline" }}>
            <b style={{ fontSize: 17 }}>{id.name}</b>
            {id.nameEn && id.nameEn !== id.name && <span className="muted">({id.nameEn})</span>}
            <span>
              {id.setName} <span className="muted mono">{id.setId}</span> #{id.number}
            </span>
            <span className="pill gray">{id.game === "onepiece" ? "One Piece" : "Pokémon"} {id.lang.toUpperCase()}</span>
            {id.variant !== "base" && <span className="pill gray">{id.variant}</span>}
            <button className="small" onClick={startEdit}>
              Corriger
            </button>
          </div>
        )}
        {!id && !editing && item.captureStatus === "done" && (
          <button className="small" onClick={startEdit}>
            Saisir l'identité à la main
          </button>
        )}
        {id?.warnings.map((w) => (
          <div key={w} className="warn">
            {w}
          </div>
        ))}

        {id && id.candidates.length > 1 && !editing && (
          <label className="field">
            Autres cartes possibles
            <select
              value={id.cardKey}
              onChange={(e) => patch({ candidateCardKey: e.target.value })}
              disabled={busy}
            >
              {id.candidates.map((c) => (
                <option key={c.cardKey} value={c.cardKey}>
                  {c.name} — {c.setName} #{c.number} {c.variant !== "base" ? `(${c.variant})` : ""} · {Math.round(c.score * 100)} % · {c.reason}
                </option>
              ))}
            </select>
          </label>
        )}

        {editing && edit && (
          <div className="stack" style={{ background: "var(--bg)", padding: 10, borderRadius: 8 }}>
            <div className="fields">
              <label className="field">
                Jeu
                <select value={edit.game} onChange={(e) => setEdit({ ...edit, game: e.target.value as IdentityEdit["game"] })}>
                  <option value="pokemon">Pokémon</option>
                  <option value="onepiece">One Piece</option>
                </select>
              </label>
              <label className="field">
                Langue
                <select value={edit.lang} onChange={(e) => setEdit({ ...edit, lang: e.target.value as IdentityEdit["lang"] })}>
                  <option value="fr">FR</option>
                  <option value="en">EN</option>
                  <option value="ja">JP</option>
                </select>
              </label>
              {(["setId", "setName", "number", "name", "nameEn", "variant"] as const).map((k) => (
                <label className="field" key={k}>
                  {{ setId: "Id du set", setName: "Nom du set", number: "Numéro", name: "Nom imprimé", nameEn: "Nom anglais", variant: "Variante" }[k]}
                  <input value={edit[k] ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="row">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void patch({ identity: { ...edit, nameEn: edit.nameEn || null, variant: edit.variant || "base" } }).then(() => setEditing(false))
                }
              >
                Enregistrer
              </button>
              <button onClick={() => setEditing(false)}>Annuler</button>
            </div>
          </div>
        )}

        {psa && (
          <div className="stack">
            <div className="small muted">{psa.reason}</div>
            {psa.title && <Copyable label={psa.status === "green" ? "Titre PSA" : "Libellé déduit"} text={psa.title} />}
            {psa.specId && <Copyable label="Spec" text={psa.specId} mono />}
            <details open={psa.status !== "green"}>
              <summary className="small">Recherches PSA ({psa.searchStrings.length})</summary>
              <div className="stack" style={{ marginTop: 6 }}>
                {psa.searchStrings.map((s) => (
                  <Copyable key={s} text={s} />
                ))}
              </div>
            </details>
            <details open={psa.status === "red"}>
              <summary className="small">Champs de saisie manuelle</summary>
              <div className="fields" style={{ marginTop: 6 }}>
                {fields &&
                  (Object.keys(FIELD_LABELS) as (keyof ManualFields)[]).map((k) => (
                    <label className="field" key={k}>
                      <span className="row" style={{ justifyContent: "space-between" }}>
                        {FIELD_LABELS[k]}
                        <a href="#" onClick={(e) => { e.preventDefault(); void copyText(overrides[k] ?? fields[k]); }}>
                          copier
                        </a>
                      </span>
                      <input
                        value={overrides[k] ?? fields[k]}
                        onChange={(e) => setOverrides({ ...overrides, [k]: e.target.value })}
                        onBlur={() => {
                          if ((overrides[k] ?? fields[k]) !== fields[k] || item.manualOverrides?.[k] !== overrides[k]) void patch({ manualOverrides: overrides });
                        }}
                      />
                    </label>
                  ))}
              </div>
            </details>
            {psa.researchRequest && (
              <details>
                <summary className="small">PSA Research Request pré-rédigée (à faire avant envoi)</summary>
                <div className="stack" style={{ marginTop: 6 }}>
                  <Copyable text={psa.researchRequest.description} />
                  {psa.researchRequest.links.map((l) => (
                    <a key={l} href={l} target="_blank" rel="noreferrer" className="small">
                      {l}
                    </a>
                  ))}
                </div>
              </details>
            )}
            {psa.status !== "green" || !psa.title || psa.reason.startsWith("Libellé du certificat") ? (
              <div className="stack" style={{ borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
                <span className="small">Trouvé chez PSA ? Colle le titre exact affiché par le Submission Center :</span>
                <div className="row">
                  <input className="grow" placeholder="2023 POKEMON JAPANESE SV2a-POKEMON CARD 151 #201 CHARIZARD ex…" value={found} onChange={(e) => setFound(e.target.value)} />
                  <input style={{ width: 110 }} placeholder="Spec (option)" value={specId} onChange={(e) => setSpecId(e.target.value)} />
                </div>
                <div className="row">
                  <select value={usedSearch} onChange={(e) => setUsedSearch(e.target.value)} className="grow small">
                    <option value="">Recherche qui a marché (facultatif)</option>
                    {["{subject} {number} {brand}", "{brand} {subject}", "{subject} {number}", "{year} {subject} {setName}", "{subject}"].map((p) => (
                      <option key={p} value={p}>
                        {p.replace(/[{}]/g, "")}
                      </option>
                    ))}
                  </select>
                  <button className="primary" disabled={!found.trim() || busy} onClick={confirmFound}>
                    Trouvé chez PSA
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <div className="row">
          <label className="field" style={{ width: 140 }}>
            Valeur déclarée ($)
            <input
              type="number"
              min="0"
              step="1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => {
                const v = value === "" ? null : Number(value);
                if (v !== item.declaredValue) void patch({ declaredValue: v });
              }}
            />
          </label>
          <label className="field grow">
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (item.notes ?? "") && void patch({ notes: notes || null })} />
          </label>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
