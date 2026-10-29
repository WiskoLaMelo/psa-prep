/** Minuscules, sans accents ni ponctuation, espaces simples. */
export function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Similarité de 0 à 1 entre deux noms, insensible à la casse et aux accents. */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9 * (Math.min(x.length, y.length) / Math.max(x.length, y.length)) + 0.1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** Similarité par mots communs (Jaccard), utile pour comparer un nom de set à une chaîne PSA. */
export function tokenOverlap(a: string, b: string): number {
  const x = new Set(normalize(a).split(" ").filter(Boolean));
  const y = new Set(normalize(b).split(" ").filter(Boolean));
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

export function stripLeadingZeros(n: string): string {
  return n.replace(/^0+(?=\d)/, "");
}
