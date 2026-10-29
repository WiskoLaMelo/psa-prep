import { eq, and } from "drizzle-orm";
import type { Db } from "../db";
import { catalogSets } from "../db/schema";
import { makeCardKey, setKey } from "../cards/key";
import type { Lang } from "../types";
import { getJson, mapLimit, type FetchLike } from "../util/http";
import { backfillEnglishNames, upsertCards, upsertSets, type CatalogCardRow } from "./store";

const API = "https://api.tcgdex.net/v2";

interface TcgdexSetBrief {
  id: string;
  name: string;
  cardCount?: { total?: number; official?: number };
}

interface TcgdexSet extends TcgdexSetBrief {
  serie?: { id: string; name: string };
  releaseDate?: string;
  abbreviation?: { official?: string; localized?: string; [k: string]: string | undefined };
  tcgOnline?: string;
  cards?: { id: string; localId: string; name: string; image?: string }[];
}

export interface SyncProgress {
  (msg: string): void;
}

/** URL d'image TCGdex : la base renvoyée par l'API + qualité + extension. */
export function tcgdexImage(base: string | null | undefined, quality: "low" | "high" = "low"): string | null {
  return base ? `${base}/${quality}.webp` : null;
}

/** Codes imprimés connus pour un set : abréviation officielle, localisée, code en ligne, et l'id lui-même pour le japonais. */
export function setCodes(set: TcgdexSet, lang: Lang): string[] {
  const codes = new Set<string>();
  for (const v of Object.values(set.abbreviation ?? {})) if (v) codes.add(v);
  if (set.tcgOnline) codes.add(set.tcgOnline);
  if (lang === "ja") codes.add(set.id);
  return [...codes];
}

/**
 * Synchronise le catalogue Pokémon TCGdex pour les langues demandées.
 * Seuls les sets nouveaux ou dont le nombre de cartes a changé sont retéléchargés (sauf force).
 */
export async function syncTcgdex(
  db: Db,
  opts: { langs?: Lang[]; force?: boolean; fetch?: FetchLike; onProgress?: SyncProgress; setFilter?: (id: string) => boolean } = {},
) {
  const langs = opts.langs ?? ["en", "fr", "ja"];
  const log = opts.onProgress ?? (() => {});
  const summary: Record<string, { sets: number; cards: number; skipped: number }> = {};
  // L'anglais d'abord : il sert de secours et fournit name_en aux autres langues.
  for (const lang of [...langs].sort((a, b) => (a === "en" ? -1 : b === "en" ? 1 : 0))) {
    const list = (await getJson<TcgdexSetBrief[]>(`${API}/${lang}/sets`, { fetch: opts.fetch })) ?? [];
    const known = new Map(
      db
        .select({ setId: catalogSets.setId, cardCount: catalogSets.cardCount })
        .from(catalogSets)
        .where(and(eq(catalogSets.game, "pokemon"), eq(catalogSets.lang, lang)))
        .all()
        .map((r) => [r.setId, r.cardCount]),
    );
    const todo = list.filter(
      (s) =>
        (!opts.setFilter || opts.setFilter(s.id)) &&
        (opts.force || !known.has(s.id) || known.get(s.id) !== (s.cardCount?.total ?? null)),
    );
    const stat = { sets: 0, cards: 0, skipped: list.length - todo.length };
    log(`[pokemon/${lang}] ${list.length} sets, ${todo.length} à synchroniser`);
    await mapLimit(todo, 4, async (brief) => {
      const set = await getJson<TcgdexSet>(`${API}/${lang}/sets/${encodeURIComponent(brief.id)}`, { fetch: opts.fetch });
      if (!set) return;
      const cards: CatalogCardRow[] = (set.cards ?? []).map((c) => ({
        cardKey: makeCardKey({ game: "pokemon", lang, setId: set.id, number: c.localId, variant: "base" }),
        game: "pokemon",
        lang,
        setId: set.id,
        setName: set.name,
        number: c.localId,
        name: c.name,
        nameEn: lang === "en" ? c.name : null,
        variant: "base",
        imageUrl: tcgdexImage(c.image),
        source: "tcgdex",
      }));
      upsertCards(db, cards);
      upsertSets(db, [
        {
          key: setKey("pokemon", lang, set.id),
          game: "pokemon",
          lang,
          setId: set.id,
          name: set.name,
          series: set.serie?.name ?? null,
          codesJson: JSON.stringify(setCodes(set, lang)),
          releaseDate: set.releaseDate ?? null,
          cardCount: set.cardCount?.total ?? cards.length,
          officialCount: set.cardCount?.official ?? null,
          source: "tcgdex",
        },
      ]);
      stat.sets++;
      stat.cards += cards.length;
      if (stat.sets % 20 === 0) log(`[pokemon/${lang}] ${stat.sets}/${todo.length} sets`);
    });
    summary[lang] = stat;
  }
  backfillEnglishNames(db, "pokemon");
  return summary;
}
