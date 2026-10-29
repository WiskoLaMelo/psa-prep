import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db";
import { mappings, psaItems, psaSetLinks, psaSets } from "../db/schema";
import { setKey } from "../cards/key";
import type { CardIdentity, ManualFields, PsaResolution } from "../types";
import { applyNumber, applySubject, composeLabel, searchStrings, type LabelParts } from "./naming";
import { rulesOf } from "./store";

const GAME_BRAND: Record<string, string> = { pokemon: "POKEMON", onepiece: "ONE PIECE" };
const LANG_WORD: Record<string, string> = { ja: "JAPANESE", fr: "FRENCH", en: "" };

function researchRequest(identity: CardIdentity, fields: ManualFields): PsaResolution["researchRequest"] {
  const links: string[] = [];
  if (identity.game === "pokemon") links.push(`https://www.tcgdex.net/database/${identity.setId}/${identity.number}`);
  if (identity.game === "onepiece") links.push(`https://${identity.lang === "fr" ? "fr" : identity.lang === "ja" ? "www" : "en"}.onepiece-cardgame.com/cardlist/`);
  if (identity.imageUrl) links.push(identity.imageUrl);
  const langLabel = { fr: "French", en: "English", ja: "Japanese" }[identity.lang];
  return {
    description:
      `Requesting a new set/spec for a ${langLabel} ${identity.game === "pokemon" ? "Pokémon" : "One Piece"} card not found in the PSA database. ` +
      `Set: ${identity.setName} (${identity.setId})${fields.year ? `, released ${fields.year}` : ""}. ` +
      `Card: ${fields.subject} #${identity.number}${fields.variety ? ` (${fields.variety})` : ""}. Printed name: ${identity.name}.`,
    links,
  };
}

/** Champs de saisie manuelle au mieux, sans règle connue. */
function fallbackParts(identity: CardIdentity): LabelParts {
  return {
    year: identity.releaseYear ? String(identity.releaseYear) : "",
    brand: [GAME_BRAND[identity.game], LANG_WORD[identity.lang], identity.setName.toUpperCase()].filter(Boolean).join(" "),
    number: identity.number,
    subject: (identity.nameEn ?? identity.name).toUpperCase(),
    variety: identity.variant !== "base" ? identity.variant.toUpperCase().replace(/-/g, " ") : "",
    setName: identity.setName,
  };
}

/**
 * Traduit une identité de carte en référence PSA :
 * vert = correspondance confirmée, orange = set PSA connu (libellé déduit), rouge = set inconnu.
 */
export function resolvePsa(db: Db, identity: CardIdentity, overrides?: Partial<ManualFields> | null): PsaResolution {
  const applyOverrides = (f: ManualFields): ManualFields => ({ ...f, ...Object.fromEntries(Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined && v !== "")) });

  const mapped = db
    .select({ item: psaItems, set: psaSets })
    .from(mappings)
    .innerJoin(psaItems, eq(psaItems.id, mappings.psaItemId))
    .innerJoin(psaSets, eq(psaSets.id, psaItems.psaSetId))
    .where(and(eq(mappings.cardKey, identity.cardKey), eq(mappings.status, "confirmed")))
    .get();
  if (mapped && (mapped.item.source === "cert_api" || mapped.item.source === "user_confirmed")) {
    const { item, set } = mapped;
    const fields = applyOverrides({ year: set.year ?? "", brand: set.psaSetString, number: item.numberPsa, subject: item.subjectPsa, variety: item.varietyPsa });
    const parts: LabelParts = { ...fields, setName: identity.setName };
    const title = item.titleExact ?? item.label;
    const strings = [title, ...searchStrings(rulesOf(set), parts).map((s) => s.text)].filter((s, i, a) => a.indexOf(s) === i);
    return {
      status: "green",
      reason: item.titleExact ? "Titre PSA exact confirmé" : `Libellé du certificat ${item.exampleCert ?? ""}`.trim(),
      title,
      specId: item.specId,
      psaItemId: item.id,
      psaSetId: set.id,
      searchStrings: strings,
      manualFields: fields,
      researchRequest: null,
    };
  }

  const linked = db
    .select({ set: psaSets })
    .from(psaSetLinks)
    .innerJoin(psaSets, eq(psaSets.id, psaSetLinks.psaSetId))
    .where(eq(psaSetLinks.catalogSetKey, setKey(identity.game, identity.lang, identity.setId)))
    .orderBy(desc(psaSetLinks.confirmedAt))
    .all()
    .map((r) => r.set);
  // Plusieurs sets PSA possibles pour un set catalogue (ex. holo / non holo) : le plus documenté d'abord.
  const set = linked.sort((a, b) => rulesOf(b).examples - rulesOf(a).examples)[0];
  if (set) {
    const rules = rulesOf(set);
    const variety = rules.varieties[identity.variant] ?? (identity.variant === "base" ? "" : identity.variant.toUpperCase().replace(/-/g, " "));
    const fields = applyOverrides({
      year: set.year ?? (identity.releaseYear ? String(identity.releaseYear) : ""),
      brand: set.psaSetString,
      number: applyNumber(rules, identity.setId, identity.number),
      subject: applySubject(rules, identity.name, identity.nameEn),
      variety,
    });
    const parts: LabelParts = { ...fields, setName: identity.setName };
    return {
      status: "orange",
      reason: `Set PSA connu (${rules.examples} exemple${rules.examples > 1 ? "s" : ""}), carte jamais vue : libellé déduit`,
      title: composeLabel(fields),
      specId: null,
      psaItemId: null,
      psaSetId: set.id,
      searchStrings: searchStrings(rules, parts).map((s) => s.text).slice(0, 4),
      manualFields: fields,
      researchRequest: null,
    };
  }

  const parts = fallbackParts(identity);
  const fields = applyOverrides(parts);
  return {
    status: "red",
    reason: "Aucun set PSA correspondant connu : saisie manuelle, et Research Request conseillée avant envoi",
    title: null,
    specId: null,
    psaItemId: null,
    psaSetId: null,
    searchStrings: searchStrings({ numberFormat: "as_catalog", subjectSource: "en", subjectCase: "upper", varieties: {}, searchWins: {}, examples: 0 }, { ...fields, setName: identity.setName })
      .map((s) => s.text)
      .slice(0, 4),
    manualFields: fields,
    researchRequest: researchRequest(identity, fields),
  };
}
