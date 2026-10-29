import { openDb, type Db } from "../db";
import { upsertCards, upsertSets, backfillEnglishNames } from "../catalog/store";
import { makeCardKey, setKey } from "../cards/key";
import type { VisionReading } from "../identify/reading";
import type { Game, Lang } from "../types";

export function memDb(): Db {
  return openDb(":memory:");
}

type SeedCard = { game: Game; lang: Lang; setId: string; setName: string; number: string; name: string; variant?: string; imageUrl?: string };

export function seedCards(db: Db, cards: SeedCard[]) {
  upsertCards(
    db,
    cards.map((c) => ({
      cardKey: makeCardKey({ ...c, variant: c.variant ?? "base" }),
      game: c.game,
      lang: c.lang,
      setId: c.setId,
      setName: c.setName,
      number: c.number,
      name: c.name,
      nameEn: c.lang === "en" ? c.name : null,
      variant: c.variant ?? "base",
      imageUrl: c.imageUrl ?? null,
      source: "test",
    })),
  );
}

export function seedSet(db: Db, s: { game: Game; lang: Lang; setId: string; name: string; codes?: string[]; releaseDate?: string; officialCount?: number }) {
  upsertSets(db, [
    {
      key: setKey(s.game, s.lang, s.setId),
      game: s.game,
      lang: s.lang,
      setId: s.setId,
      name: s.name,
      codesJson: JSON.stringify(s.codes ?? []),
      releaseDate: s.releaseDate ?? null,
      cardCount: s.officialCount ?? null,
      officialCount: s.officialCount ?? null,
      source: "test",
    },
  ]);
}

/** Petit catalogue de référence : 151 (EN/FR/JP), Évolutions à Paldea (EN seulement), One Piece OP05. */
export function seedReferenceCatalog(db: Db) {
  seedSet(db, { game: "pokemon", lang: "en", setId: "sv03.5", name: "151", codes: ["MEW"], releaseDate: "2023-09-22", officialCount: 165 });
  seedSet(db, { game: "pokemon", lang: "fr", setId: "sv03.5", name: "151", codes: ["MEW", "151"], releaseDate: "2023-09-22", officialCount: 165 });
  seedSet(db, { game: "pokemon", lang: "ja", setId: "SV2a", name: "ポケモンカード151", codes: ["SV2a"], releaseDate: "2023-06-16", officialCount: 165 });
  seedSet(db, { game: "pokemon", lang: "en", setId: "sv02", name: "Paldea Evolved", codes: ["PAL"], releaseDate: "2023-06-09", officialCount: 193 });
  seedSet(db, { game: "pokemon", lang: "fr", setId: "sv02", name: "Évolutions à Paldea", codes: ["PAL"], releaseDate: "2023-06-09", officialCount: 193 });
  seedSet(db, { game: "pokemon", lang: "en", setId: "base1", name: "Base Set", codes: [], releaseDate: "1999-01-09", officialCount: 102 });
  seedSet(db, { game: "pokemon", lang: "en", setId: "base4", name: "Base Set 2", codes: [], releaseDate: "2000-02-24", officialCount: 130 });
  seedSet(db, { game: "onepiece", lang: "en", setId: "OP05", name: "BOOSTER PACK Awakening of the New Era", codes: ["OP05"] });
  seedSet(db, { game: "onepiece", lang: "fr", setId: "OP05", name: "BOOSTER L'Éveil d'une Nouvelle Ère", codes: ["OP05"] });
  seedCards(db, [
    { game: "pokemon", lang: "en", setId: "sv03.5", setName: "151", number: "001", name: "Bulbasaur" },
    { game: "pokemon", lang: "en", setId: "sv03.5", setName: "151", number: "006", name: "Charizard ex" },
    { game: "pokemon", lang: "en", setId: "sv03.5", setName: "151", number: "199", name: "Charizard ex" },
    { game: "pokemon", lang: "fr", setId: "sv03.5", setName: "151", number: "001", name: "Bulbizarre" },
    { game: "pokemon", lang: "fr", setId: "sv03.5", setName: "151", number: "006", name: "Dracaufeu-ex" },
    { game: "pokemon", lang: "ja", setId: "SV2a", setName: "ポケモンカード151", number: "201", name: "リザードンex" },
    { game: "pokemon", lang: "ja", setId: "SV2a", setName: "ポケモンカード151", number: "006", name: "リザードンex" },
    { game: "pokemon", lang: "en", setId: "sv02", setName: "Paldea Evolved", number: "203", name: "Magikarp" },
    { game: "pokemon", lang: "en", setId: "base1", setName: "Base Set", number: "4", name: "Charizard" },
    { game: "pokemon", lang: "en", setId: "base4", setName: "Base Set 2", number: "4", name: "Charizard" },
    { game: "onepiece", lang: "en", setId: "OP05", setName: "BOOSTER PACK Awakening of the New Era", number: "119", name: "Monkey.D.Luffy" },
    { game: "onepiece", lang: "en", setId: "OP05", setName: "BOOSTER PACK Awakening of the New Era", number: "119", name: "Monkey.D.Luffy", variant: "p1" },
    { game: "onepiece", lang: "fr", setId: "OP05", setName: "BOOSTER L'Éveil d'une Nouvelle Ère", number: "119", name: "Monkey D. Luffy" },
  ]);
  backfillEnglishNames(db, "pokemon");
  backfillEnglishNames(db, "onepiece");
}

export function reading(r: Partial<VisionReading>): VisionReading {
  return {
    game: "pokemon",
    language: "en",
    printed_name: null,
    name_english: null,
    printed_number: null,
    set_code: null,
    set_symbol_description: null,
    set_name_guess: null,
    rarity_mark: null,
    regulation_mark: null,
    stamps: [],
    variant_hints: [],
    is_graded_slab: false,
    slab_cert_number: null,
    confidence: { game: 0.99, language: 0.99, name: 0.95, number: 0.95, set_code: 0.95 },
    notes: null,
    ...r,
  };
}
