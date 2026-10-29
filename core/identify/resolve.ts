import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db";
import { catalogCards, catalogSets } from "../db/schema";
import { makeCardKey } from "../cards/key";
import type { CardCandidate, CardIdentity, Game, Lang } from "../types";
import { normalize, similarity } from "../util/text";
import { numberForms, parseOnePieceNumber, parsePokemonNumber, PROMO_PREFIXES } from "./numbers";
import type { VisionReading } from "./reading";

type CardRow = typeof catalogCards.$inferSelect;
type SetRow = typeof catalogSets.$inferSelect;

const MAX_CANDIDATES = 5;

/** Variante déduite des indices de lecture (Pokémon). La rareté holo d'origine n'est pas une variante. */
export function pokemonVariant(r: VisionReading): string {
  const parts: string[] = [];
  const stamps = r.stamps.map((s) => normalize(s));
  if (r.variant_hints.includes("first_edition") || stamps.some((s) => /1st|edition 1|1ere/.test(s))) parts.push("1st-edition");
  if (r.variant_hints.includes("shadowless")) parts.push("shadowless");
  if (r.variant_hints.includes("reverse_holo")) parts.push("reverse");
  if (stamps.some((s) => s.includes("prerelease"))) parts.push("prerelease");
  if (stamps.some((s) => s.includes("staff"))) parts.push("staff");
  if (stamps.some((s) => s.includes("set logo") || s.includes("logo"))) parts.push("stamp");
  return parts.length ? parts.join("-") : "base";
}

function nameScore(row: CardRow, r: VisionReading): number {
  return Math.max(
    similarity(row.name, r.printed_name),
    similarity(row.nameEn, r.name_english),
    similarity(row.name, r.name_english),
    similarity(row.nameEn, r.printed_name),
  );
}

function searchLangs(game: Game, lang: Lang): Lang[] {
  // Les sets japonais Pokémon ont leurs propres identifiants : pas de secours anglais par id.
  if (game === "pokemon" && lang === "ja") return ["ja"];
  return lang === "en" ? ["en"] : [lang, "en"];
}

function findSetsByCode(db: Db, game: Game, langs: Lang[], code: string): SetRow[] {
  const c = code.trim();
  if (!c) return [];
  const promoIds = PROMO_PREFIXES[c.toUpperCase()] ?? [];
  return db
    .select()
    .from(catalogSets)
    .where(
      and(
        eq(catalogSets.game, game),
        inArray(catalogSets.lang, langs),
        sql`(lower(${catalogSets.setId}) = lower(${c})
          or exists (select 1 from json_each(${catalogSets.codesJson}) j where lower(j.value) = lower(${c}))
          ${promoIds.length ? sql`or ${catalogSets.setId} in ${promoIds}` : sql``})`,
      ),
    )
    .all();
}

function toCandidate(row: CardRow, game: Game, lang: Lang, variant: string, score: number, reason: string): CardCandidate {
  return {
    catalogKey: row.cardKey,
    cardKey: makeCardKey({ game, lang, setId: row.setId, number: row.number, variant }),
    setId: row.setId,
    setName: row.setName,
    number: row.number,
    name: row.name,
    variant,
    imageUrl: row.imageUrl,
    score: Math.round(score * 1000) / 1000,
    reason,
  };
}

function dedupe(cands: CardCandidate[]): CardCandidate[] {
  const best = new Map<string, CardCandidate>();
  for (const c of cands) {
    // Une même carte trouvée en FR et en EN : on garde la meilleure, en privilégiant la langue réelle.
    const k = c.cardKey;
    const prev = best.get(k);
    if (!prev || c.score > prev.score) best.set(k, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}

function resolvePokemon(db: Db, r: VisionReading, lang: Lang): { cands: CardCandidate[]; method: CardIdentity["method"] } {
  const parsed = parsePokemonNumber(r.printed_number);
  const variant = pokemonVariant(r);
  const langs = searchLangs("pokemon", lang);
  const langPenalty = (row: CardRow) => (row.lang === lang ? 0 : 0.03);
  const cands: CardCandidate[] = [];

  if (parsed) {
    const forms = numberForms(parsed.number);
    const codes = [r.set_code, parsed.embeddedCode].filter((c): c is string => Boolean(c));
    const sets = codes.flatMap((c) => findSetsByCode(db, "pokemon", langs, c));
    if (sets.length) {
      const rows = db
        .select()
        .from(catalogCards)
        .where(
          and(
            eq(catalogCards.game, "pokemon"),
            inArray(catalogCards.lang, langs),
            inArray(catalogCards.setId, [...new Set(sets.map((s) => s.setId))]),
            inArray(catalogCards.number, forms),
          ),
        )
        .all();
      for (const row of rows) {
        const ns = nameScore(row, r);
        const set = sets.find((s) => s.setId === row.setId && s.lang === row.lang);
        const totalOk = parsed.total && set?.officialCount ? String(set.officialCount) === parsed.total.replace(/^0+/, "") : false;
        cands.push(
          toCandidate(row, "pokemon", lang, variant, 0.55 + 0.4 * ns + (totalOk ? 0.05 : 0) - langPenalty(row), `code ${codes[0]} + numéro, nom ${Math.round(ns * 100)} %`),
        );
      }
      if (cands.some((c) => c.score >= 0.8)) return { cands: dedupe(cands), method: "set_code" };
    }

    // Sans code fiable : numéro + nom, départagé par le total imprimé.
    const rows = db
      .select()
      .from(catalogCards)
      .where(and(eq(catalogCards.game, "pokemon"), inArray(catalogCards.lang, langs), inArray(catalogCards.number, forms)))
      .all();
    const setTotals = new Map(
      db
        .select({ setId: catalogSets.setId, lang: catalogSets.lang, officialCount: catalogSets.officialCount })
        .from(catalogSets)
        .where(and(eq(catalogSets.game, "pokemon"), inArray(catalogSets.lang, langs)))
        .all()
        .map((s) => [`${s.lang}:${s.setId}`, s.officialCount]),
    );
    for (const row of rows) {
      const ns = nameScore(row, r);
      if (ns < 0.6) continue;
      const total = setTotals.get(`${row.lang}:${row.setId}`);
      const totalOk = parsed.total && total ? String(total) === parsed.total.replace(/^0+/, "") : false;
      cands.push(
        toCandidate(row, "pokemon", lang, variant, 0.35 + 0.35 * ns + (totalOk ? 0.2 : 0) - langPenalty(row), `numéro + nom${totalOk ? " + total" : ""}`),
      );
    }
    if (cands.length) {
      const out = dedupe(cands);
      // Plusieurs sets avec le même nom et le même numéro : ambigu, l'image départagera.
      return { cands: out, method: "name_number" };
    }
  }

  // Dernier recours : le nom seul (cartes anciennes sans numéro lisible), à départager par l'image.
  const name = r.printed_name ?? r.name_english;
  if (name) {
    const rows = db
      .select()
      .from(catalogCards)
      .where(and(eq(catalogCards.game, "pokemon"), inArray(catalogCards.lang, langs), sql`lower(${catalogCards.name}) like ${`%${name.toLowerCase().slice(0, 4)}%`}`))
      .limit(400)
      .all();
    for (const row of rows) {
      const ns = nameScore(row, r);
      if (ns >= 0.85) cands.push(toCandidate(row, "pokemon", lang, variant, 0.25 * ns, "nom seul"));
    }
  }
  return { cands: dedupe(cands), method: cands.length ? "image" : "none" };
}

function resolveOnePiece(db: Db, r: VisionReading, lang: Lang): { cands: CardCandidate[]; method: CardIdentity["method"] } {
  const id = parseOnePieceNumber(r.printed_number, r.set_code);
  if (!id) return { cands: [], method: "none" };
  const langs = searchLangs("onepiece", lang);
  const rows = db
    .select()
    .from(catalogCards)
    .where(
      and(
        eq(catalogCards.game, "onepiece"),
        inArray(catalogCards.lang, langs),
        eq(catalogCards.setId, id.setId),
        inArray(catalogCards.number, numberForms(id.number)),
      ),
    )
    .all();
  const wantsParallel = r.variant_hints.some((h) => h === "parallel" || h === "alt_art" || h === "manga" || h === "special_art");
  const cands = rows.map((row) => {
    const ns = nameScore(row, r);
    const isBase = row.variant === "base";
    // L'identifiant est universel : il fait l'essentiel du score, la variante se joue sur les indices.
    const variantFit = wantsParallel ? (isBase ? 0 : row.variant === "p1" ? 0.1 : 0.06) : isBase ? 0.1 : 0;
    const nameKnown = Boolean(r.printed_name || r.name_english);
    const score = 0.75 + (nameKnown ? 0.15 * ns : 0.1) + variantFit - (row.lang === lang ? 0 : 0.02);
    return toCandidate(row, "onepiece", lang, row.variant, Math.min(score, 1), `identifiant ${id.setId}-${id.number}${isBase ? "" : ` (${row.variant})`}`);
  });
  return { cands: dedupe(cands), method: "card_id" };
}

function visionFactor(r: VisionReading, game: Game): number {
  const c = r.confidence;
  const key = game === "onepiece" ? c.number : Math.min(c.number, Math.max(c.name, c.set_code));
  return Math.max(0, Math.min(1, 0.5 + 0.5 * key));
}

/** Transforme une lecture en identité vérifiée contre le catalogue local. */
export function resolveIdentity(db: Db, r: VisionReading): CardIdentity {
  const game: Game = r.game === "onepiece" ? "onepiece" : "pokemon";
  const lang: Lang = r.language === "fr" || r.language === "ja" ? r.language : "en";
  const warnings: string[] = [];
  if (r.game === "unknown") warnings.push("Jeu non reconnu sur la photo");
  if (r.language === "other" || r.language === "unknown") warnings.push("Langue non reconnue, anglais supposé");
  if (r.notes) warnings.push(r.notes);

  const { cands, method } = game === "onepiece" ? resolveOnePiece(db, r, lang) : resolvePokemon(db, r, lang);
  const top = cands[0];
  if (!top) {
    return {
      game,
      lang,
      setId: r.set_code ?? "",
      setName: r.set_name_guess ?? "",
      number: r.printed_number ?? "",
      name: r.printed_name ?? r.name_english ?? "",
      nameEn: r.name_english,
      variant: game === "pokemon" ? pokemonVariant(r) : "base",
      cardKey: makeCardKey({ game, lang, setId: r.set_code || "unknown", number: r.printed_number || "unknown", variant: "base" }),
      catalogKey: null,
      releaseYear: null,
      imageUrl: null,
      confidence: 0,
      method: "none",
      candidates: [],
      warnings: [...warnings, "Aucune carte correspondante dans le catalogue"],
    };
  }

  let confidence = top.score * visionFactor(r, game);
  const second = cands[1];
  if (second && top.score - second.score < 0.05) {
    confidence *= 0.6;
    warnings.push(`Plusieurs cartes possibles (${cands.length}), à vérifier`);
  }
  if (method === "image") confidence = Math.min(confidence, 0.5);
  if (!top.catalogKey.startsWith(`${game}:${lang}:`)) warnings.push(`Fiche ${lang.toUpperCase()} absente du catalogue : fiche anglaise utilisée`);

  const row = db.select().from(catalogCards).where(eq(catalogCards.cardKey, top.catalogKey)).get();
  const set = db
    .select({ releaseDate: catalogSets.releaseDate })
    .from(catalogSets)
    .where(and(eq(catalogSets.game, game), eq(catalogSets.setId, top.setId)))
    .get();
  return {
    game,
    lang,
    setId: top.setId,
    setName: top.setName,
    number: top.number,
    name: lang === "ja" && game === "onepiece" && r.printed_name ? r.printed_name : top.name,
    nameEn: row?.nameEn ?? r.name_english ?? null,
    variant: top.variant,
    cardKey: top.cardKey,
    catalogKey: top.catalogKey,
    releaseYear: set?.releaseDate ? Number(set.releaseDate.slice(0, 4)) : null,
    imageUrl: top.imageUrl,
    confidence: Math.round(confidence * 1000) / 1000,
    method,
    candidates: cands,
    warnings,
  };
}

/** Reconstruit une identité à partir d'un candidat choisi par l'utilisateur. */
export function identityFromCandidate(db: Db, base: CardIdentity, cand: CardCandidate): CardIdentity {
  const row = db.select().from(catalogCards).where(eq(catalogCards.cardKey, cand.catalogKey)).get();
  const set = db
    .select({ releaseDate: catalogSets.releaseDate })
    .from(catalogSets)
    .where(and(eq(catalogSets.game, base.game), eq(catalogSets.setId, cand.setId)))
    .get();
  return {
    ...base,
    setId: cand.setId,
    setName: cand.setName,
    number: cand.number,
    name: cand.name,
    nameEn: row?.nameEn ?? base.nameEn,
    variant: cand.variant,
    cardKey: cand.cardKey,
    catalogKey: cand.catalogKey,
    imageUrl: cand.imageUrl,
    releaseYear: set?.releaseDate ? Number(set.releaseDate.slice(0, 4)) : base.releaseYear,
    confidence: 1,
    method: "manual",
    warnings: [],
  };
}
