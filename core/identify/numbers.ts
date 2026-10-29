import { stripLeadingZeros } from "../util/text";

export interface ParsedPokemonNumber {
  number: string;
  total: string | null;
  /** Code d'extension trouvé dans la chaîne du numéro (ex. "SV2a 151/165" ou "085/SV-P"). */
  embeddedCode: string | null;
}

/** Préfixes de promos → ids de sets TCGdex probables (indice seulement, toujours vérifié par le nom). */
export const PROMO_PREFIXES: Record<string, string[]> = {
  SWSH: ["swshp"],
  SVP: ["svp"],
  "SV-P": ["svp", "SV-P"],
  SM: ["smp"],
  "SM-P": ["smp", "SM-P"],
  XY: ["xyp"],
  "XY-P": ["xyp", "XY-P"],
  BW: ["bwp"],
  "BW-P": ["bwp", "BW-P"],
  DP: ["dpp"],
  HGSS: ["hgssp"],
  "S-P": ["S-P"],
};

export function parsePokemonNumber(raw: string | null | undefined): ParsedPokemonNumber | null {
  if (!raw) return null;
  let s = raw.trim().replace(/\s+/g, " ").replace(/^n[°o]\s*/i, "");
  let embeddedCode: string | null = null;

  // "085/SV-P", "001/S-P" : numéro de promo japonaise.
  let m = s.match(/^(\d{1,3})\s*\/\s*([A-Z]{1,4}-P)$/i);
  if (m) return { number: m[1]!, total: null, embeddedCode: m[2]!.toUpperCase() };

  // "SVP 085", "SV-P 085", "SWSH050", "SM60", "XY120" : promos internationales.
  m = s.match(/^([A-Z]{2,4}-?P?)\s*-?\s*(\d{1,3})$/i);
  if (m && PROMO_PREFIXES[m[1]!.toUpperCase()]) {
    const prefix = m[1]!.toUpperCase();
    const digits = m[2]!;
    // Les promos SWSH/SM/XY/BW sont numérotées avec leur préfixe dans TCGdex (SWSH050), SVP sans (085).
    const number = prefix === "SVP" || prefix.endsWith("-P") ? digits : `${prefix}${digits.padStart(prefix === "SWSH" ? 3 : 2, "0")}`;
    return { number, total: null, embeddedCode: prefix };
  }

  // "SV2a 151/165" : code devant le numéro.
  m = s.match(/^([A-Za-z]{1,4}\d{0,2}[a-z]?(?:\.\d)?)\s+(.+\/.+)$/);
  if (m) {
    embeddedCode = m[1]!;
    s = m[2]!;
  }

  // "151/165", "TG12/TG30", "GG01/GG70", "SV001/SV122".
  m = s.match(/^([A-Za-z]{0,3}\d{1,3}[a-z]?)\s*\/\s*([A-Za-z]{0,3}\d{1,3})$/);
  if (m) return { number: m[1]!.toUpperCase().replace(/^(\d+)([A-Z])$/, (_, d, l) => `${d}${l.toLowerCase()}`), total: m[2]!.toUpperCase(), embeddedCode };

  m = s.match(/^([A-Za-z]{0,4}\d{1,3}[a-z]?)$/);
  if (m) return { number: m[1]!, total: null, embeddedCode };
  return null;
}

/** Formes de numéro à essayer dans le catalogue : "007", "7", "TG07", "TG7"… */
export function numberForms(n: string): string[] {
  const forms = new Set<string>([n]);
  const m = n.match(/^([A-Za-z]*)(\d+)([a-z]?)$/);
  if (m) {
    const [, prefix, digits, suffix] = m as unknown as [string, string, string, string];
    const bare = stripLeadingZeros(digits);
    for (const d of [digits, bare, bare.padStart(2, "0"), bare.padStart(3, "0")]) {
      forms.add(`${prefix}${d}${suffix}`);
      forms.add(`${prefix.toUpperCase()}${d}${suffix}`);
    }
  }
  return [...forms];
}

/** Numéro One Piece "OP05-119", éventuellement lu en morceaux (code + numéro). */
export function parseOnePieceNumber(printed: string | null, setCode: string | null): { setId: string; number: string } | null {
  const tryParse = (s: string) => {
    const m = s.toUpperCase().replace(/\s+/g, "").match(/([A-Z]{1,4}\d{0,3})-(\d{1,3})/);
    return m ? { setId: m[1]!, number: m[2]!.padStart(3, "0") } : null;
  };
  if (printed) {
    const r = tryParse(printed);
    if (r) return r;
  }
  if (printed && setCode && /^\d{1,3}$/.test(printed.trim())) return tryParse(`${setCode}-${printed.trim()}`);
  return null;
}
