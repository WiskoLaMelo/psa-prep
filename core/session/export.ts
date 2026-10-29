import type { Db } from "../db";
import { toCsv } from "../util/csv";
import { getSession, listItems, type SessionItemView } from "./service";

export const CSV_HEADER = [
  "position",
  "jeu",
  "langue",
  "set",
  "set_id",
  "numero",
  "nom",
  "nom_en",
  "variante",
  "statut",
  "confiance",
  "titre_psa",
  "spec_id",
  "recherche_psa",
  "annee",
  "marque",
  "numero_psa",
  "sujet",
  "variete",
  "valeur_declaree",
  "notes",
];

const STATUS_FR = { green: "confirmé", orange: "déduit", red: "set inconnu" } as const;

function row(i: SessionItemView): unknown[] {
  const id = i.identity;
  const p = i.psa;
  return [
    i.position,
    id?.game ?? "",
    id?.lang ?? "",
    id?.setName ?? "",
    id?.setId ?? "",
    id?.number ?? "",
    id?.name ?? "",
    id?.nameEn ?? "",
    id?.variant ?? "",
    p ? STATUS_FR[p.status] : "à identifier",
    id ? id.confidence.toFixed(2) : "",
    p?.title ?? "",
    p?.specId ?? "",
    p?.searchStrings[0] ?? "",
    p?.manualFields.year ?? "",
    p?.manualFields.brand ?? "",
    p?.manualFields.number ?? "",
    p?.manualFields.subject ?? "",
    p?.manualFields.variety ?? "",
    i.declaredValue ?? "",
    i.notes ?? "",
  ];
}

export function exportCsv(db: Db, sessionId: string): string {
  return "﻿" + toCsv(CSV_HEADER, listItems(db, sessionId).map(row));
}

/** Format consommé par l'extension Chrome (phase 2). Versionné pour pouvoir évoluer. */
export interface SessionExport {
  format: "psa-prep-session";
  version: 1;
  session: { id: string; name: string; createdAt: string };
  items: {
    itemId: number;
    position: number;
    cardKey: string | null;
    status: "green" | "orange" | "red" | null;
    title: string | null;
    specId: string | null;
    searchStrings: string[];
    manualFields: { year: string; brand: string; number: string; subject: string; variety: string } | null;
    declaredValue: number | null;
    label: string;
  }[];
}

export function exportJson(db: Db, sessionId: string): SessionExport {
  const s = getSession(db, sessionId);
  if (!s) throw new Error("Session introuvable");
  return {
    format: "psa-prep-session",
    version: 1,
    session: { id: s.id, name: s.name, createdAt: s.createdAt },
    items: listItems(db, sessionId).map((i) => ({
      itemId: i.id,
      position: i.position,
      cardKey: i.identity?.cardKey ?? null,
      status: i.psa?.status ?? null,
      title: i.psa?.title ?? null,
      specId: i.psa?.specId ?? null,
      searchStrings: i.psa?.searchStrings ?? [],
      manualFields: i.psa?.manualFields ?? null,
      declaredValue: i.declaredValue,
      label: i.identity ? `${i.identity.name} — ${i.identity.setName} #${i.identity.number}` : `Carte ${i.position}`,
    })),
  };
}
