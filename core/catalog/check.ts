import { sql } from "drizzle-orm";
import type { Db } from "../db";
import { resolveIdentity } from "../identify/resolve";
import type { VisionReading } from "../identify/reading";
import type { Game, Lang } from "../types";

/**
 * Contrôle du catalogue (critère M0) : pour chaque jeu et langue, prend n cartes de sets récents
 * et vérifie qu'une lecture « code + numéro » les retrouve exactement.
 */
export function checkCatalog(db: Db, n = 10) {
  const groups = db.all<{ game: Game; lang: Lang }>(sql`select distinct game, lang from catalog_cards order by game, lang`);
  const out: { game: Game; lang: Lang; query: string; expected: string; found: string | null; ok: boolean }[] = [];
  for (const { game, lang } of groups) {
    const rows = db.all<{ card_key: string; set_id: string; number: string; name: string; codes_json: string; official_count: number | null }>(sql`
      select c.card_key, c.set_id, c.number, c.name, s.codes_json, s.official_count
      from catalog_cards c join catalog_sets s on s.game = c.game and s.lang = c.lang and s.set_id = c.set_id
      where c.game = ${game} and c.lang = ${lang} and c.variant = 'base' and s.codes_json != '[]'
      order by s.release_date desc, random() limit ${n}`);
    for (const r of rows) {
      const code = (JSON.parse(r.codes_json) as string[])[0]!;
      const printed = game === "onepiece" ? `${r.set_id}-${r.number}` : r.official_count ? `${r.number}/${r.official_count}` : r.number;
      const reading: VisionReading = {
        game,
        language: lang,
        printed_name: r.name,
        name_english: null,
        printed_number: printed,
        set_code: code,
        set_symbol_description: null,
        set_name_guess: null,
        rarity_mark: null,
        regulation_mark: null,
        stamps: [],
        variant_hints: [],
        is_graded_slab: false,
        slab_cert_number: null,
        confidence: { game: 1, language: 1, name: 1, number: 1, set_code: 1 },
        notes: null,
      };
      const id = resolveIdentity(db, reading);
      out.push({ game, lang, query: `${code} ${printed} ${r.name}`, expected: r.card_key, found: id.catalogKey, ok: id.catalogKey === r.card_key });
    }
  }
  return out;
}
