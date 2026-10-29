/** Comparaison de titres PSA insensible à la casse, aux espaces et à la ponctuation légère. */
export function normTitle(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Choisit le résultat dont le titre correspond exactement au titre attendu.
 * Sans titre exact connu (orange/rouge), on n'en choisit un que s'il est le seul à contenir sujet + numéro.
 */
export function pickResult(
  titles: string[],
  want: { title: string | null; subject?: string; number?: string },
): { index: number; exact: boolean } | null {
  if (want.title) {
    const t = normTitle(want.title);
    const i = titles.findIndex((x) => normTitle(x) === t);
    if (i >= 0) return { index: i, exact: true };
  }
  if (want.subject && want.number) {
    const subj = normTitle(want.subject);
    const num = want.number.replace(/^0+(?=\d)/, "");
    const re = new RegExp(`(^|[ #-])0*${num.replace(/[-]/g, "\\-")}( |$)`);
    const hits = titles.map((x, i) => ({ x: normTitle(x), i })).filter(({ x }) => x.includes(subj) && re.test(x));
    if (hits.length === 1) return { index: hits[0]!.i, exact: false };
  }
  return null;
}
