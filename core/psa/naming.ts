import { normalize, stripLeadingZeros } from "../util/text";

/** Règles de nommage d'un set PSA, déduites de libellés réels (jamais codées en dur). */
export interface NamingRules {
  numberFormat: "as_catalog" | "strip_zeros" | "pad3" | "with_set_prefix" | "none" | "unknown";
  subjectSource: "en" | "local" | "unknown";
  /** upper_keep_lower : majuscules sauf les mots déjà en minuscules dans le nom (ex. "CHARIZARD ex"). */
  subjectCase: "upper" | "upper_keep_lower" | "as_is" | "unknown";
  /** Variante du catalogue → mot(s) de variété PSA observés. */
  varieties: Record<string, string>;
  /** Motifs de recherche ayant fonctionné, avec leur nombre de succès. */
  searchWins: Record<string, number>;
  examples: number;
}

export const EMPTY_RULES: NamingRules = {
  numberFormat: "unknown",
  subjectSource: "unknown",
  subjectCase: "unknown",
  varieties: {},
  searchWins: {},
  examples: 0,
};

export interface NamingExample {
  setId: string;
  catalogNumber: string;
  catalogName: string;
  catalogNameEn: string | null;
  variant: string;
  psaNumber: string;
  psaSubject: string;
  psaVariety: string;
}

function mostCommon<T extends string>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function numberFormatOf(ex: NamingExample): NamingRules["numberFormat"] {
  const psa = ex.psaNumber.trim();
  const cat = ex.catalogNumber.trim();
  if (!psa) return "none";
  if (psa === cat) return "as_catalog";
  if (psa.toUpperCase() === `${ex.setId}-${cat}`.toUpperCase()) return "with_set_prefix";
  if (psa === stripLeadingZeros(cat)) return "strip_zeros";
  if (/^\d+$/.test(cat) && psa === cat.padStart(3, "0")) return "pad3";
  return "unknown";
}

/** Apprend les règles d'un set PSA à partir de cartes dont le libellé PSA est connu. */
export function learnRules(examples: NamingExample[], previous: NamingRules = EMPTY_RULES): NamingRules {
  if (!examples.length) return { ...previous };
  const numberFormat = mostCommon(examples.map(numberFormatOf).filter((f) => f !== "unknown")) ?? "unknown";
  const subjectSource =
    mostCommon(
      examples
        .map((e): NamingRules["subjectSource"] => {
          const s = normalize(e.psaSubject);
          if (e.catalogNameEn && s.includes(normalize(e.catalogNameEn))) return "en";
          if (s.includes(normalize(e.catalogName))) return "local";
          return "unknown";
        })
        .filter((v) => v !== "unknown"),
    ) ?? "unknown";
  // Chaque exemple peut correspondre à plusieurs casses ; on retient celle qui explique le plus d'exemples.
  const caseVotes = new Map<NamingRules["subjectCase"], number>();
  for (const e of examples) {
    const src = e.catalogNameEn && normalize(e.psaSubject).includes(normalize(e.catalogNameEn)) ? e.catalogNameEn : e.catalogName;
    // Nom en écriture japonaise sans équivalent anglais : rien à apprendre sur la casse.
    if (!/[A-Za-z]/.test(src) || /[\u3040-\u30ff\u4e00-\u9fff]/.test(src)) continue;
    const fits: NamingRules["subjectCase"][] = [];
    if (e.psaSubject.includes(upperKeepLower(src))) fits.push("upper_keep_lower");
    if (e.psaSubject.includes(src.toUpperCase())) fits.push("upper");
    if (!fits.length) fits.push("as_is");
    for (const f of fits) caseVotes.set(f, (caseVotes.get(f) ?? 0) + 1);
  }
  const order: NamingRules["subjectCase"][] = ["upper_keep_lower", "upper", "as_is"];
  const subjectCase = [...caseVotes.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0]?.[0] ?? "unknown";
  const varieties: Record<string, string> = { ...previous.varieties };
  for (const variant of new Set(examples.map((e) => e.variant))) {
    const values = examples.filter((e) => e.variant === variant).map((e) => e.psaVariety.trim());
    const unanimous = values.every((v) => v === values[0]);
    // La variété d'une carte de base dépend souvent de sa rareté (SAR, AR…) : il faut plusieurs exemples concordants.
    if (unanimous && (variant !== "base" || values.length >= 2)) varieties[variant] = values[0]!;
    else delete varieties[variant];
  }
  return { numberFormat, subjectSource, subjectCase, varieties, searchWins: { ...previous.searchWins }, examples: examples.length };
}

export function applyNumber(rules: NamingRules, setId: string, catalogNumber: string): string {
  switch (rules.numberFormat) {
    case "strip_zeros":
      return stripLeadingZeros(catalogNumber);
    case "pad3":
      return /^\d+$/.test(catalogNumber) ? catalogNumber.padStart(3, "0") : catalogNumber;
    case "with_set_prefix":
      return `${setId}-${catalogNumber}`;
    case "none":
      return "";
    default:
      return catalogNumber;
  }
}

export function upperKeepLower(name: string): string {
  return name
    .split(" ")
    .map((w) => (w && w === w.toLowerCase() && /[a-z]/.test(w) ? w : w.toUpperCase()))
    .join(" ");
}

export function applySubject(rules: NamingRules, name: string, nameEn: string | null): string {
  const base = rules.subjectSource === "local" ? name : (nameEn ?? name);
  if (rules.subjectCase === "as_is") return base;
  if (rules.subjectCase === "upper_keep_lower") return upperKeepLower(base);
  return base.toUpperCase();
}

export interface LabelParts {
  year: string;
  brand: string;
  number: string;
  subject: string;
  variety: string;
  setName: string;
}

export const DEFAULT_SEARCH_PATTERNS = [
  "{subject} {number} {brand}",
  "{brand} {subject}",
  "{subject} {number}",
  "{year} {subject} {setName}",
  "{subject}",
];

export function fillPattern(pattern: string, p: LabelParts): string {
  return pattern
    .replace(/\{(\w+)\}/g, (_, k: keyof LabelParts) => (k === "number" && p.number ? `#${p.number}` : (p[k] ?? "")))
    .replace(/\s+/g, " ")
    .trim();
}

/** Chaînes de recherche classées : d'abord les motifs qui ont déjà marché pour ce set. */
export function searchStrings(rules: NamingRules, p: LabelParts): { pattern: string; text: string }[] {
  const patterns = [...DEFAULT_SEARCH_PATTERNS].sort((a, b) => (rules.searchWins[b] ?? 0) - (rules.searchWins[a] ?? 0));
  const seen = new Set<string>();
  const out: { pattern: string; text: string }[] = [];
  for (const pattern of patterns) {
    const text = fillPattern(pattern, p);
    if (text && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      out.push({ pattern, text });
    }
  }
  return out;
}

export function composeLabel(p: Pick<LabelParts, "year" | "brand" | "number" | "subject" | "variety">): string {
  return [p.year, p.brand, p.number ? `#${p.number}` : "", p.subject, p.variety].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Découpe un titre PSA collé par l'utilisateur ("2023 POKEMON JAPANESE SV2a-POKEMON CARD 151 #201 CHARIZARD ex SAR")
 * en année / marque / numéro / sujet / variété, à l'aide de l'identité connue de la carte.
 */
export function parsePsaTitle(title: string, hint: { number: string; name: string; nameEn: string | null }): {
  year: string;
  brand: string;
  number: string;
  subject: string;
  variety: string;
} {
  const t = title.replace(/\s+/g, " ").trim();
  const yearM = t.match(/^(\d{4}(?:-\d{2,4})?)\s+/);
  const year = yearM?.[1] ?? "";
  const rest = yearM ? t.slice(yearM[0].length) : t;
  const upper = rest.toUpperCase();

  const numCandidates = [hint.number, stripLeadingZeros(hint.number), hint.number.padStart(3, "0")].filter(Boolean);
  let numIdx = -1;
  let numLen = 0;
  let number = "";
  const hashM = rest.match(/#\s*([A-Z0-9-]+)/i);
  if (hashM) {
    numIdx = hashM.index!;
    numLen = hashM[0].length;
    number = hashM[1]!;
  } else {
    for (const n of numCandidates) {
      const m = new RegExp(`(^|\\s)(${n.replace(/[-]/g, "\\-")})(?=\\s|$)`, "i").exec(rest);
      if (m) {
        numIdx = m.index + m[1]!.length;
        numLen = m[2]!.length;
        number = m[2]!;
        break;
      }
    }
  }

  let subjIdx = -1;
  let subjLen = 0;
  for (const n of [hint.nameEn, hint.name].filter((x): x is string => Boolean(x))) {
    const i = upper.indexOf(n.toUpperCase());
    if (i >= 0) {
      subjIdx = i;
      subjLen = n.length;
      break;
    }
  }

  const marks = [numIdx, subjIdx].filter((i) => i >= 0);
  const brandEnd = marks.length ? Math.min(...marks) : rest.length;
  const brand = rest.slice(0, brandEnd).trim();
  const afterEnd = Math.max(numIdx >= 0 ? numIdx + numLen : 0, subjIdx >= 0 ? subjIdx + subjLen : 0);
  let subject = subjIdx >= 0 ? rest.slice(subjIdx, subjIdx + subjLen) : "";
  let variety = afterEnd ? rest.slice(afterEnd).replace(/^[\s-]+/, "").trim() : "";
  // Sujet introuvable : tout ce qui suit le numéro est considéré comme sujet.
  if (subjIdx < 0 && numIdx >= 0) {
    subject = rest.slice(numIdx + numLen).trim();
    variety = "";
  }
  return { year, brand, number, subject, variety };
}
