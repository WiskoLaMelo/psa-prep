import { eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { psaItems, psaSets } from "../db/schema";
import { rulesOf, suggestCatalogMatches } from "./store";

/** Items PSA importés sans carte du catalogue associée. */
export function listUnlinkedPsaItems(db: Db) {
  const rows = db
    .select({ item: psaItems, set: psaSets })
    .from(psaItems)
    .innerJoin(psaSets, eq(psaSets.id, psaItems.psaSetId))
    .where(sql`not exists (select 1 from mappings m where m.psa_item_id = ${psaItems.id})`)
    .all();
  return rows.map((r) => ({ ...r, suggestions: suggestCatalogMatches(db, r.item, r.set) }));
}

/** Sets PSA connus, avec leurs règles apprises et le nombre de cartes reliées. */
export function listPsaSets(db: Db) {
  const rows = db.all<{ id: number; items: number; linked: number; catalog_sets: string | null }>(sql`
    select s.id,
      (select count(*) from psa_items i where i.psa_set_id = s.id) as items,
      (select count(*) from mappings m join psa_items i on i.id = m.psa_item_id where i.psa_set_id = s.id) as linked,
      (select group_concat(l.catalog_set_key, ', ') from psa_set_links l where l.psa_set_id = s.id) as catalog_sets
    from psa_sets s`);
  const stats = new Map(rows.map((r) => [r.id, r]));
  return db
    .select()
    .from(psaSets)
    .all()
    .map((s) => ({ ...s, rules: rulesOf(s), items: stats.get(s.id)?.items ?? 0, linked: stats.get(s.id)?.linked ?? 0, catalogSets: stats.get(s.id)?.catalog_sets ?? "" }));
}

export function listPsaItemsForSet(db: Db, psaSetId: number) {
  return db.all<{ id: number; label: string; title_exact: string | null; spec_id: string | null; source: string; card_key: string | null }>(sql`
    select i.id, i.label, i.title_exact, i.spec_id, i.source, m.card_key
    from psa_items i left join mappings m on m.psa_item_id = i.id
    where i.psa_set_id = ${psaSetId} order by i.number_psa`);
}
