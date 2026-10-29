import { sql } from "drizzle-orm";
import type { Db } from "../db";
import { catalogCards, catalogSets } from "../db/schema";

export type CatalogSetRow = typeof catalogSets.$inferInsert;
export type CatalogCardRow = typeof catalogCards.$inferInsert;

export function upsertSets(db: Db, rows: CatalogSetRow[]) {
  if (!rows.length) return;
  db.insert(catalogSets)
    .values(rows.map((r) => ({ ...r, updatedAt: new Date().toISOString() })))
    .onConflictDoUpdate({
      target: catalogSets.key,
      set: {
        name: sql`excluded.name`,
        series: sql`excluded.series`,
        codesJson: sql`excluded.codes_json`,
        releaseDate: sql`excluded.release_date`,
        cardCount: sql`excluded.card_count`,
        officialCount: sql`excluded.official_count`,
        source: sql`excluded.source`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .run();
}

/** Insère ou met à jour des cartes, sans écraser un hash d'image déjà calculé. */
export function upsertCards(db: Db, rows: CatalogCardRow[]) {
  const CHUNK = 400;
  db.transaction((tx) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      tx.insert(catalogCards)
        .values(rows.slice(i, i + CHUNK).map((r) => ({ ...r, updatedAt: new Date().toISOString() })))
        .onConflictDoUpdate({
          target: catalogCards.cardKey,
          set: {
            setName: sql`excluded.set_name`,
            name: sql`excluded.name`,
            nameEn: sql`coalesce(excluded.name_en, ${catalogCards.nameEn})`,
            rarity: sql`coalesce(excluded.rarity, ${catalogCards.rarity})`,
            imageUrl: sql`excluded.image_url`,
            source: sql`excluded.source`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .run();
    }
  });
}

/** Renseigne name_en des cartes FR à partir de la même carte en anglais (sets internationaux). */
export function backfillEnglishNames(db: Db, game: string) {
  db.run(sql`
    update catalog_cards as c set name_en = (
      select e.name from catalog_cards e
      where e.game = c.game and e.lang = 'en' and e.set_id = c.set_id and e.number = c.number and e.variant = c.variant
    )
    where c.game = ${game} and c.lang != 'en' and c.name_en is null`);
  db.run(sql`update catalog_cards set name_en = name where game = ${game} and lang = 'en' and name_en is null`);
}

export function catalogStats(db: Db) {
  return db.all<{ game: string; lang: string; sets: number; cards: number; updated: string | null }>(sql`
    select s.game, s.lang, count(distinct s.set_id) as sets,
      (select count(*) from catalog_cards c where c.game = s.game and c.lang = s.lang) as cards,
      max(s.updated_at) as updated
    from catalog_sets s group by s.game, s.lang order by s.game, s.lang`);
}
