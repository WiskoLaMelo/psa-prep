import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db";
import { sha256 } from "./identify/image";
import { identifyImage, type PipelineDeps } from "./session/pipeline";
import { resolvePsa } from "./psa/resolve";
import { parseCsv, toCsv } from "./util/csv";
import { normalize, stripLeadingZeros } from "./util/text";
import type { CardIdentity } from "./types";

/** Colonnes acceptées dans truth.csv (français ou anglais). */
const COLS = {
  file: ["fichier", "file"],
  game: ["jeu", "game"],
  lang: ["langue", "lang", "language"],
  set: ["set", "extension"],
  number: ["numero", "numéro", "number"],
  name: ["nom", "name"],
  variant: ["variante", "variant"],
  psaTitle: ["titre_psa", "titre psa", "psa_title", "titre"],
  category: ["categorie", "catégorie", "category"],
} as const;

function col(row: Record<string, string>, key: keyof typeof COLS): string {
  for (const k of COLS[key]) if (row[k] !== undefined) return row[k]!;
  return "";
}

const GAME_ALIASES: Record<string, string> = { "one piece": "onepiece", onepiece: "onepiece", op: "onepiece", pokemon: "pokemon", "pokémon": "pokemon" };
const LANG_ALIASES: Record<string, string> = { fr: "fr", francais: "fr", "français": "fr", en: "en", anglais: "en", english: "en", ja: "ja", jp: "ja", japonais: "ja", japanese: "ja" };

export interface EvalRow {
  file: string;
  category: string;
  expected: string;
  got: string;
  confidence: number;
  correct: boolean;
  psaStatus: string;
  reason: string;
}

function sameNumber(a: string, b: string) {
  const n = (s: string) => stripLeadingZeros(s.toUpperCase().replace(/^.*-/, "").replace(/\/.*$/, "").trim());
  return n(a) === n(b);
}

function matches(id: CardIdentity, row: Record<string, string>): { ok: boolean; reason: string } {
  const game = GAME_ALIASES[normalize(col(row, "game"))] ?? normalize(col(row, "game"));
  const lang = LANG_ALIASES[normalize(col(row, "lang"))] ?? normalize(col(row, "lang"));
  const set = normalize(col(row, "set"));
  const variant = normalize(col(row, "variant"));
  const problems: string[] = [];
  if (game && id.game !== game) problems.push(`jeu ${id.game}≠${game}`);
  if (lang && id.lang !== lang) problems.push(`langue ${id.lang}≠${lang}`);
  if (col(row, "number") && !sameNumber(id.number, col(row, "number"))) problems.push(`numéro ${id.number}≠${col(row, "number")}`);
  if (set && ![normalize(id.setId), normalize(id.setName)].some((s) => s === set || s.includes(set) || set.includes(s))) problems.push(`set ${id.setId}≠${col(row, "set")}`);
  if (variant && variant !== "base" && normalize(id.variant) !== variant) problems.push(`variante ${id.variant}≠${variant}`);
  return { ok: problems.length === 0, reason: problems.join(", ") };
}

/** Évalue l'identification sur test-cards/ (critère M1) et écrit un rapport CSV. */
export async function runEval(db: Db, dir: string, deps: PipelineDeps = {}, onRow?: (r: EvalRow, i: number, n: number) => void) {
  const truthFile = path.join(dir, "truth.csv");
  if (!fs.existsSync(truthFile)) throw new Error(`Fichier introuvable : ${truthFile}`);
  const rows = parseCsv(fs.readFileSync(truthFile, "utf8")).filter((r) => col(r, "file"));
  const results: EvalRow[] = [];
  let cost = 0;
  for (const [i, row] of rows.entries()) {
    const file = path.join(dir, col(row, "file"));
    const category = normalize(col(row, "category")) || "recent";
    const expected = [col(row, "game"), col(row, "lang"), col(row, "set"), col(row, "number"), col(row, "name")].join(" / ");
    let r: EvalRow;
    try {
      const img = fs.readFileSync(file);
      const res = await identifyImage(db, sha256(img), img, deps);
      cost += res.costUsd;
      const m = matches(res.identity, row);
      const psa = resolvePsa(db, res.identity);
      r = {
        file: col(row, "file"),
        category,
        expected,
        got: `${res.identity.game} / ${res.identity.lang} / ${res.identity.setId} ${res.identity.setName} / ${res.identity.number} / ${res.identity.name} [${res.identity.variant}]`,
        confidence: res.identity.confidence,
        correct: m.ok,
        psaStatus: psa.status,
        reason: m.reason,
      };
    } catch (e) {
      r = { file: col(row, "file"), category, expected, got: "ERREUR", confidence: 0, correct: false, psaStatus: "", reason: e instanceof Error ? e.message : String(e) };
    }
    results.push(r);
    onRow?.(r, i, rows.length);
  }
  const recent = results.filter((r) => r.category === "recent" || r.category === "recente" || r.category === "récent");
  const highConfErrors = results.filter((r) => !r.correct && r.confidence >= 0.9);
  const summary = {
    total: results.length,
    correct: results.filter((r) => r.correct).length,
    recentTotal: recent.length,
    recentCorrect: recent.filter((r) => r.correct).length,
    recentAccuracy: recent.length ? recent.filter((r) => r.correct).length / recent.length : 0,
    highConfidenceErrors: highConfErrors.length,
    costUsd: cost,
    /** Critère M1 : ≥ 90 % sur les cartes récentes et aucune erreur à confiance ≥ 0,9. */
    m1Passed: recent.length > 0 && recent.filter((r) => r.correct).length / recent.length >= 0.9 && highConfErrors.length === 0,
  };
  const report = path.join(dir, "eval-report.csv");
  fs.writeFileSync(
    report,
    "﻿" +
      toCsv(
        ["fichier", "categorie", "attendu", "obtenu", "confiance", "correct", "statut_psa", "ecart"],
        results.map((r) => [r.file, r.category, r.expected, r.got, r.confidence.toFixed(2), r.correct ? "oui" : "NON", r.psaStatus, r.reason]),
      ),
  );
  return { summary, results, report };
}
