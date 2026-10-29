import type { Db } from "../db";
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

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

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
    // Nom de set = pack d'origine de la version de base de la carte.
    const setNames = new Map<string, string>();
    for (const c of cards) {
      const id = parseOnePieceId(c.card_id);
      if (!id) continue;
      if (id.variant === "base" && !setNames.has(id.setId)) setNames.set(id.setId, packTitle(c.pack_id));
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
    for (const r of rows) r.setName = setNames.get(r.setId) ?? r.setId;
    upsertCards(db, rows);
    const sets: CatalogSetRow[] = [...new Set(rows.map((r) => r.setId))].map((setId) => ({
      key: setKey("onepiece", lang, setId),
      game: "onepiece",
      lang,
      setId,
      name: setNames.get(setId) ?? setId,
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
