import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { catalogCards, catalogSets, certs, mappings, psaItems, psaSetLinks, psaSets } from "../db/schema";
import { parseCardKey, setKey, withLang } from "../cards/key";
import type { CardIdentity, Game, Lang, Source } from "../types";
import { numberForms } from "../identify/numbers";
import { similarity, tokenOverlap } from "../util/text";
import { certLabel, detectGameLang, fetchCert, type PsaCert } from "./cert-api";
import { EMPTY_RULES, learnRules, parsePsaTitle, type NamingExample, type NamingRules } from "./naming";
import type { FetchLike } from "../util/http";

export type PsaItemRow = typeof psaItems.$inferSelect;
export type PsaSetRow = typeof psaSets.$inferSelect;

export function rulesOf(set: Pick<PsaSetRow, "namingRulesJson">): NamingRules {
  try {
    return { ...EMPTY_RULES, ...(JSON.parse(set.namingRulesJson) as Partial<NamingRules>) };
  } catch {
    return { ...EMPTY_RULES };
  }
}

export function upsertPsaSet(db: Db, s: { game: Game; lang: Lang; psaSetString: string; year: string | null; category?: string | null; source: Source }): PsaSetRow {
  const existing = db
    .select()
    .from(psaSets)
    .where(and(eq(psaSets.psaSetString, s.psaSetString), s.year ? eq(psaSets.year, s.year) : sql`${psaSets.year} is null`))
    .get();
  if (existing) {
    // Une source plus fiable remplace une source déduite.
    if (existing.source === "inferred" && s.source !== "inferred") db.update(psaSets).set({ source: s.source }).where(eq(psaSets.id, existing.id)).run();
    return existing;
  }
  return db
    .insert(psaSets)
    .values({ game: s.game, lang: s.lang, psaSetString: s.psaSetString, year: s.year, category: s.category ?? null, source: s.source })
    .returning()
    .get();
}

export function upsertPsaItem(
  db: Db,
  i: { psaSetId: number; specId?: string | null; titleExact?: string | null; label: string; numberPsa: string; subjectPsa: string; varietyPsa: string; source: Source; exampleCert?: string | null },
): PsaItemRow {
  const existing =
    (i.specId ? db.select().from(psaItems).where(eq(psaItems.specId, i.specId)).get() : undefined) ??
    db
      .select()
      .from(psaItems)
      .where(and(eq(psaItems.psaSetId, i.psaSetId), eq(psaItems.numberPsa, i.numberPsa), eq(psaItems.subjectPsa, i.subjectPsa), eq(psaItems.varietyPsa, i.varietyPsa)))
      .get();
  if (existing) {
    const patch: Partial<PsaItemRow> = {};
    if (i.specId && !existing.specId) patch.specId = i.specId;
    if (i.titleExact) patch.titleExact = i.titleExact;
    if (i.exampleCert && !existing.exampleCert) patch.exampleCert = i.exampleCert;
    if (existing.source === "inferred" && i.source !== "inferred") patch.source = i.source;
    if (Object.keys(patch).length) {
      patch.verifiedAt = new Date().toISOString();
      return db.update(psaItems).set(patch).where(eq(psaItems.id, existing.id)).returning().get();
    }
    return existing;
  }
  return db
    .insert(psaItems)
    .values({
      psaSetId: i.psaSetId,
      specId: i.specId ?? null,
      titleExact: i.titleExact ?? null,
      label: i.label,
      numberPsa: i.numberPsa,
      subjectPsa: i.subjectPsa,
      varietyPsa: i.varietyPsa,
      source: i.source,
      exampleCert: i.exampleCert ?? null,
    })
    .returning()
    .get();
}

/** Fiche catalogue d'une card_key, ou de la même carte en anglais si la langue réelle manque. */
export function catalogRowFor(db: Db, cardKey: string) {
  const exact = db.select().from(catalogCards).where(eq(catalogCards.cardKey, cardKey)).get();
  if (exact) return exact;
  const p = parseCardKey(cardKey);
  const base = { ...p, variant: "base" };
  for (const key of [withLang(cardKey, "en"), `${base.game}:${base.lang}:${base.setId}:${base.number}:base`, `${base.game}:en:${base.setId}:${base.number}:base`]) {
    const row = db.select().from(catalogCards).where(eq(catalogCards.cardKey, key)).get();
    if (row) return row;
  }
  return undefined;
}

/** Recalcule les règles de nommage d'un set PSA à partir de toutes ses correspondances confirmées. */
export function relearnSet(db: Db, psaSetId: number): NamingRules {
  const set = db.select().from(psaSets).where(eq(psaSets.id, psaSetId)).get();
  if (!set) return { ...EMPTY_RULES };
  const rows = db
    .select({ cardKey: mappings.cardKey, item: psaItems })
    .from(mappings)
    .innerJoin(psaItems, eq(psaItems.id, mappings.psaItemId))
    .where(and(eq(psaItems.psaSetId, psaSetId), eq(mappings.status, "confirmed")))
    .all();
  const examples: NamingExample[] = [];
  for (const r of rows) {
    const p = parseCardKey(r.cardKey);
    const cat = catalogRowFor(db, r.cardKey);
    examples.push({
      setId: p.setId,
      catalogNumber: p.number,
      catalogName: cat?.name ?? r.item.subjectPsa ?? "",
      catalogNameEn: cat?.nameEn ?? null,
      variant: p.variant,
      psaNumber: r.item.numberPsa,
      psaSubject: r.item.subjectPsa,
      psaVariety: r.item.varietyPsa,
    });
  }
  const rules = learnRules(examples, rulesOf(set));
  db.update(psaSets).set({ namingRulesJson: JSON.stringify(rules), verifiedAt: new Date().toISOString() }).where(eq(psaSets.id, psaSetId)).run();
  return rules;
}

/** Enregistre « cette carte du catalogue = cet item PSA », lie les sets et réapprend les règles. */
export function linkCard(db: Db, cardKey: string, psaItemId: number, source: Source) {
  const item = db.select().from(psaItems).where(eq(psaItems.id, psaItemId)).get();
  if (!item) throw new Error(`Item PSA ${psaItemId} introuvable`);
  db.insert(mappings)
    .values({ cardKey, psaItemId, status: "confirmed", source, confidence: 1 })
    .onConflictDoUpdate({ target: mappings.cardKey, set: { psaItemId, status: "confirmed", source, confidence: 1, confirmedAt: new Date().toISOString() } })
    .run();
  const p = parseCardKey(cardKey);
  db.insert(psaSetLinks)
    .values({ catalogSetKey: setKey(p.game, p.lang, p.setId), psaSetId: item.psaSetId, source })
    .onConflictDoNothing()
    .run();
  return relearnSet(db, item.psaSetId);
}

export function unlinkCard(db: Db, cardKey: string) {
  const m = db.select().from(mappings).where(eq(mappings.cardKey, cardKey)).get();
  db.delete(mappings).where(eq(mappings.cardKey, cardKey)).run();
  if (m) {
    const item = db.select().from(psaItems).where(eq(psaItems.id, m.psaItemId)).get();
    if (item) relearnSet(db, item.psaSetId);
  }
}

export interface LinkSuggestion {
  cardKey: string;
  catalogKey: string;
  setName: string;
  number: string;
  name: string;
  nameEn: string | null;
  score: number;
}

/** Cartes du catalogue qui pourraient correspondre à un item PSA (numéro + sujet + nom de set). */
export function suggestCatalogMatches(db: Db, item: PsaItemRow, set: PsaSetRow, limit = 5): LinkSuggestion[] {
  const { game, lang } = { game: set.game as Game, lang: set.lang as Lang };
  const num = item.numberPsa.replace(/^#/, "");
  const opId = num.match(/^([A-Z]{1,4}\d{0,3})-(\d{1,3})$/i);
  const forms = opId ? numberForms(opId[2]!) : num ? numberForms(num) : [];
  const langs = lang === "en" ? ["en"] : [lang, "en"];
  const rows = forms.length
    ? db
        .select()
        .from(catalogCards)
        .where(
          and(
            eq(catalogCards.game, game),
            sql`${catalogCards.lang} in ${langs}`,
            sql`${catalogCards.number} in ${forms}`,
            opId ? eq(catalogCards.setId, opId[1]!.toUpperCase()) : sql`1=1`,
          ),
        )
        .all()
    : [];
  const sets = new Map(
    db
      .select()
      .from(catalogSets)
      .where(eq(catalogSets.game, game))
      .all()
      .map((s) => [`${s.lang}:${s.setId}`, s]),
  );
  const variety = item.varietyPsa.toUpperCase();
  return rows
    .map((row) => {
      const subj = Math.max(similarity(item.subjectPsa, row.nameEn), similarity(item.subjectPsa, row.name));
      const s = sets.get(`${row.lang}:${row.setId}`);
      const codes: string[] = s ? JSON.parse(s.codesJson) : [];
      const brand = set.psaSetString.toUpperCase();
      const codeHit = [row.setId, ...codes].some((c) => c.length >= 2 && new RegExp(`(^|[^A-Z0-9])${c.toUpperCase()}([^A-Z0-9]|$)`).test(brand));
      const setSim = Math.max(tokenOverlap(row.setName, set.psaSetString), codeHit ? 0.8 : 0);
      const yearOk = s?.releaseDate && set.year ? s.releaseDate.startsWith(set.year) : false;
      const variant =
        game === "onepiece" ? row.variant : /REVERSE/.test(variety) ? "reverse" : /1ST/.test(variety) ? "1st-edition" : "base";
      const variantOk = game === "onepiece" ? (row.variant === "base") === !/PARALLEL|ALT|MANGA/.test(variety) : true;
      // Nom japonais sans équivalent anglais connu : le code de set + le numéro portent seuls la preuve.
      const nameComparable = Boolean(row.nameEn) || !/[\u3040-\u30ff\u4e00-\u9fff]/.test(row.name);
      const score = nameComparable
        ? 0.45 * subj + 0.35 * setSim + (yearOk ? 0.1 : 0) + (variantOk ? 0.1 : 0)
        : 0.75 * setSim + (yearOk ? 0.1 : 0) + (variantOk ? 0.1 : 0);
      return {
        cardKey: `${game}:${lang}:${row.setId}:${row.number}:${variant}`,
        catalogKey: row.cardKey,
        setName: row.setName,
        number: row.number,
        name: row.name,
        nameEn: row.nameEn,
        score: Math.round(score * 1000) / 1000,
      };
    })
    .sort((a, b) => b.score - a.score)
    .filter((s, i, arr) => arr.findIndex((x) => x.cardKey === s.cardKey) === i)
    .slice(0, limit);
}

/** Enregistre un certificat PSA : set, item, puis lien automatique vers le catalogue si la correspondance est nette. */
export function ingestCert(db: Db, cert: PsaCert): { item: PsaItemRow; linkedCardKey: string | null; suggestions: LinkSuggestion[] } {
  const brand = (cert.Brand ?? "").trim();
  const { game, lang } = detectGameLang(brand, cert.Category);
  const set = upsertPsaSet(db, { game, lang, psaSetString: brand, year: cert.Year?.trim() || null, category: cert.Category, source: "cert_api" });
  const item = upsertPsaItem(db, {
    psaSetId: set.id,
    specId: cert.SpecID != null ? String(cert.SpecID) : null,
    label: certLabel(cert),
    numberPsa: (cert.CardNumber ?? "").trim(),
    subjectPsa: (cert.Subject ?? "").trim(),
    varietyPsa: (cert.Variety ?? "").trim(),
    source: "cert_api",
    exampleCert: String(cert.CertNumber),
  });
  db.update(certs).set({ psaItemId: item.id }).where(eq(certs.certNumber, String(cert.CertNumber))).run();
  const already = db.select().from(mappings).where(eq(mappings.psaItemId, item.id)).get();
  const suggestions = suggestCatalogMatches(db, item, set);
  if (already) return { item, linkedCardKey: already.cardKey, suggestions };
  const [top, second] = suggestions;
  // Lien automatique seulement si le meilleur candidat est net et nettement devant le suivant.
  if (top && top.score >= 0.75 && (!second || top.score - second.score >= 0.1)) {
    linkCard(db, top.cardKey, item.id, "cert_api");
    return { item, linkedCardKey: top.cardKey, suggestions };
  }
  return { item, linkedCardKey: null, suggestions };
}

export interface CertImportResult {
  cert: string;
  status: "linked" | "needs_link" | "not_found" | "error" | "cached";
  label?: string;
  cardKey?: string | null;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Importe une liste de certificats. Les réponses sont gardées définitivement : un certificat n'est jamais redemandé. */
export async function importCerts(
  db: Db,
  numbers: string[],
  opts: { token?: string; fetch?: FetchLike; delayMs?: number; onProgress?: (r: CertImportResult, i: number, n: number) => void },
): Promise<CertImportResult[]> {
  const list = [...new Set(numbers.map((n) => n.replace(/\D/g, "")).filter(Boolean))];
  const out: CertImportResult[] = [];
  let calls = 0;
  for (const [i, cert] of list.entries()) {
    let result: CertImportResult;
    try {
      const cached = db.select().from(certs).where(eq(certs.certNumber, cert)).get();
      let data: PsaCert | null;
      let fromCache = false;
      if (cached?.rawJson) {
        data = JSON.parse(cached.rawJson) as PsaCert;
        fromCache = true;
      } else if (cached && !cached.error) {
        data = null;
        fromCache = true;
      } else {
        if (!opts.token) throw new Error("PSA_API_TOKEN manquant dans .env");
        if (calls++ > 0) await sleep(opts.delayMs ?? 1500);
        data = await fetchCert(cert, { token: opts.token, fetch: opts.fetch });
        db.insert(certs)
          .values({ certNumber: cert, rawJson: data ? JSON.stringify(data) : null, error: null })
          .onConflictDoUpdate({ target: certs.certNumber, set: { rawJson: data ? JSON.stringify(data) : null, error: null, fetchedAt: new Date().toISOString() } })
          .run();
      }
      if (!data) result = { cert, status: "not_found" };
      else {
        const r = ingestCert(db, data);
        result = { cert, status: r.linkedCardKey ? (fromCache ? "cached" : "linked") : "needs_link", label: r.item.label, cardKey: r.linkedCardKey };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      db.insert(certs).values({ certNumber: cert, error: msg }).onConflictDoUpdate({ target: certs.certNumber, set: { error: msg } }).run();
      result = { cert, status: "error", error: msg };
      if (/Token PSA|Limite d'appels|PSA_API_TOKEN/.test(msg)) {
        out.push(result);
        opts.onProgress?.(result, i, list.length);
        break;
      }
    }
    out.push(result);
    opts.onProgress?.(result, i, list.length);
  }
  return out;
}

/**
 * « Trouvé chez PSA » : l'utilisateur (ou l'extension) a trouvé l'item et colle son titre exact.
 * Le titre devient une correspondance confirmée et enrichit les règles du set.
 */
export function confirmFound(
  db: Db,
  identity: CardIdentity,
  input: { title: string; specId?: string | null; searchPattern?: string | null; source?: Source },
): { item: PsaItemRow; rules: NamingRules } {
  const source = input.source ?? "user_confirmed";
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) throw new Error("Titre PSA vide");
  // Le nom anglais connu de l'identité complète le catalogue (utile aux règles des sets japonais).
  if (identity.catalogKey && identity.nameEn) {
    db.update(catalogCards).set({ nameEn: identity.nameEn }).where(and(eq(catalogCards.cardKey, identity.catalogKey), sql`${catalogCards.nameEn} is null`)).run();
  }

  // Déjà lié (ex. via un certificat) : on complète simplement le titre exact.
  const existing = db.select().from(mappings).where(eq(mappings.cardKey, identity.cardKey)).get();
  if (existing) {
    const item = db
      .update(psaItems)
      .set({ titleExact: title, ...(input.specId ? { specId: input.specId } : {}), verifiedAt: new Date().toISOString() })
      .where(eq(psaItems.id, existing.psaItemId))
      .returning()
      .get();
    if (existing.status !== "confirmed") linkCard(db, identity.cardKey, item.id, source);
    const rules = recordSearchWin(db, item.psaSetId, input.searchPattern);
    return { item, rules };
  }

  const parts = parsePsaTitle(title, { number: identity.number, name: identity.name, nameEn: identity.nameEn });
  const linked = db
    .select({ set: psaSets })
    .from(psaSetLinks)
    .innerJoin(psaSets, eq(psaSets.id, psaSetLinks.psaSetId))
    .where(eq(psaSetLinks.catalogSetKey, setKey(identity.game, identity.lang, identity.setId)))
    .all()
    .map((r) => r.set);
  const set =
    linked.find((s) => s.psaSetString.toUpperCase() === parts.brand.toUpperCase()) ??
    upsertPsaSet(db, { game: identity.game, lang: identity.lang, psaSetString: parts.brand || title, year: parts.year || null, source });
  const item = upsertPsaItem(db, {
    psaSetId: set.id,
    specId: input.specId ?? null,
    titleExact: title,
    label: title,
    numberPsa: parts.number,
    subjectPsa: parts.subject || (identity.nameEn ?? identity.name).toUpperCase(),
    varietyPsa: parts.variety,
    source,
  });
  linkCard(db, identity.cardKey, item.id, source);
  const rules = recordSearchWin(db, set.id, input.searchPattern);
  return { item, rules };
}

function recordSearchWin(db: Db, psaSetId: number, pattern?: string | null): NamingRules {
  const set = db.select().from(psaSets).where(eq(psaSets.id, psaSetId)).get();
  if (!set) return { ...EMPTY_RULES };
  const rules = rulesOf(set);
  if (pattern) {
    rules.searchWins[pattern] = (rules.searchWins[pattern] ?? 0) + 1;
    db.update(psaSets).set({ namingRulesJson: JSON.stringify(rules) }).where(eq(psaSets.id, psaSetId)).run();
  }
  return rules;
}
