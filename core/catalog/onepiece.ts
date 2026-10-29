import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { catalogSets } from "../db/schema";
import { makeCardKey, setKey } from "../cards/key";
import type { Lang } from "../types";
import { getJson, type FetchLike } from "../util/http";
import { backfillEnglishNames, upsertCards, upsertSets, type CatalogCardRow, type CatalogSetRow } from "./store";
import type { SyncProgress } from "./tcgdex";

/**
 * Données One Piece : jeu de données ouvert Punk Records (généré depuis les sites officiels par vegapull).
 * Données © Eiichiro Oda/Shueisha, Toei Animation, Bandai — usage personnel, non redistribué.
 * Le japonais n'y est pas publié : les cartes JP partagent leurs identifiants avec l'anglais (voir resolve).
 */
const BASE = "https://raw.githubusercontent.com/buhbbl/punk-records/main";
const FOLDERS: Partial<Record<Lang, string>> = { en: "english", fr: "french", ja: "japanese" };

interface PunkCard {
  card_id: string;
  name: string;
  pack_id: string;
  rarity?: string;
  category?: string;
  img_url?: string;
  img_full_url?: string;
}
interface PunkPack {
  id: string;
  raw_title: string;
  title_parts?: { prefix?: string; title?: string; label?: string };
}

/** "OP05-119_p1" → set OP05, numéro 119, variante p1. "P-001" → set P. */
export function parseOnePieceId(id: string): { setId: string; number: string; variant: string } | null {
  const m = id.trim().toUpperCase().match(/^([A-Z]{1,4}\d{0,3})-(\d{1,3})(?:_([A-Z]\d+))?$/);
  if (!m) return null;
  return { setId: m[1]!, number: m[2]!, variant: m[3] ? m[3].toLowerCase() : "base" };
}

/** Codes de set portés par l'étiquette d'un pack : "OP-05" → ["OP05"], "OP14-EB04" → ["OP14", "EB04"]. */
export function packCodes(label: string | null | undefined): string[] {
  if (!label) return [];
  return label
    .toUpperCase()
    .replace(/([A-Z]+)-(\d)/g, "$1$2")
    .split(/[-\s/]+/)
    .filter((c) => /^[A-Z]{1,4}\d{1,3}$/.test(c));
}

const ENTITIES: Record<string, string> = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: "\u00a0" };

/** Les titres sources sont parfois doublement encodés ("&amp;apos;") : on décode jusqu'à stabilité. */
export function decodeEntities(s: string): string {
  let prev = "";
  let cur = s;
  while (cur !== prev) {
    prev = cur;
    cur = cur
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&(\w+);/g, (m, name: string) => ENTITIES[name] ?? m);
  }
  return cur.replace(/\u00a0/g, " ");
}

export async function syncOnePiece(db: Db, opts: { langs?: Lang[]; fetch?: FetchLike; onProgress?: SyncProgress } = {}) {
  const log = opts.onProgress ?? (() => {});
  const langs = (opts.langs ?? ["en", "fr", "ja"]).sort((a, b) => (a === "en" ? -1 : b === "en" ? 1 : 0));
  const summary: Record<string, { sets: number; cards: number }> = {};
  for (const lang of langs) {
    const folder = FOLDERS[lang];
    if (!folder) continue;
    const [index, packs] = await Promise.all([
      getJson<Record<string, PunkCard>>(`${BASE}/${folder}/index/cards_by_id.json`, { fetch: opts.fetch }),
      getJson<Record<string, PunkPack>>(`${BASE}/${folder}/packs.json`, { fetch: opts.fetch }),
    ]);
    const cards = Object.values(index ?? {});
    if (!cards.length) {
      log(`[onepiece/${lang}] aucune donnée publiée, la langue utilisera l'anglais en secours`);
      summary[lang] = { sets: 0, cards: 0 };
      continue;
    }
    const packTitle = (id: string) => {
      const p = packs?.[id];
      return p ? decodeEntities(p.title_parts?.title ? `${p.title_parts.prefix ?? ""} ${p.title_parts.title}`.trim() : p.raw_title) : id;
    };
    const rows: CatalogCardRow[] = [];
    // Nom de set : le pack dont l'étiquette porte le code du set (« OP-05 », « OP14-EB04 »),
    // sinon le nom anglais déjà connu, sinon le pack d'origine le plus fréquent des cartes de base.
    const setNames = new Map<string, string>();
    // Les étiquettes à un seul code (« EB-04 ») passent avant les combinées (« OP14-EB04 »).
    const labelled = Object.values(packs ?? {})
      .map((p) => ({ p, codes: packCodes(p.title_parts?.label) }))
      .sort((a, b) => a.codes.length - b.codes.length);
    for (const { p, codes } of labelled) for (const code of codes) if (!setNames.has(code)) setNames.set(code, packTitle(p.id));
    const englishNames = new Map(
      db
        .select({ setId: catalogSets.setId, name: catalogSets.name })
        .from(catalogSets)
        .where(and(eq(catalogSets.game, "onepiece"), eq(catalogSets.lang, "en")))
        .all()
        .map((r) => [r.setId, r.name]),
    );
    const basePacks = new Map<string, Map<string, number>>();
    for (const c of cards) {
      const id = parseOnePieceId(c.card_id);
      if (!id) continue;
      if (id.variant === "base") {
        const m = basePacks.get(id.setId) ?? new Map<string, number>();
        m.set(c.pack_id, (m.get(c.pack_id) ?? 0) + 1);
        basePacks.set(id.setId, m);
      }
      rows.push({
        cardKey: makeCardKey({ game: "onepiece", lang, ...id }),
        game: "onepiece",
        lang,
        setId: id.setId,
        setName: "",
        number: id.number,
        name: decodeEntities(c.name),
        nameEn: lang === "en" ? decodeEntities(c.name) : null,
        variant: id.variant,
        rarity: c.rarity ?? null,
        imageUrl: c.img_full_url ?? c.img_url ?? null,
        source: "punk-records",
      });
    }
    for (const [setId, counts] of basePacks) {
      if (setNames.has(setId)) continue;
      const english = lang !== "en" ? englishNames.get(setId) : undefined;
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      setNames.set(setId, english ?? (top ? packTitle(top) : setId));
    }
    for (const r of rows) r.setName = setNames.get(r.setId) ?? englishNames.get(r.setId) ?? r.setId;
    upsertCards(db, rows);
    const sets: CatalogSetRow[] = [...new Set(rows.map((r) => r.setId))].map((setId) => ({
      key: setKey("onepiece", lang, setId),
      game: "onepiece",
      lang,
      setId,
      name: setNames.get(setId) ?? englishNames.get(setId) ?? setId,
      series: null,
      codesJson: JSON.stringify([setId]),
      releaseDate: null,
      cardCount: rows.filter((r) => r.setId === setId).length,
      officialCount: null,
      source: "punk-records",
    }));
    upsertSets(db, sets);
    log(`[onepiece/${lang}] ${sets.length} sets, ${rows.length} cartes`);
    summary[lang] = { sets: sets.length, cards: rows.length };
  }
  backfillEnglishNames(db, "onepiece");
  return summary;
}
