import { eq } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "../db";
import { catalogCards } from "../db/schema";
import type { CardCandidate } from "../types";
import type { FetchLike } from "../util/http";
import { artworkRegion, dHash, hamming, sha256 } from "./image";

/** En dessous de cette distance de hash (sur 128), deux illustrations sont considérées identiques. */
export const IMAGE_MATCH_STRONG = 20;

/** Hash de l'illustration d'une fiche catalogue, calculé une fois puis gardé en base. */
async function catalogHash(db: Db, cand: CardCandidate, opts: { fetch: FetchLike; cacheDir: string }): Promise<string | null> {
  const row = db.select({ phash: catalogCards.imagePhash }).from(catalogCards).where(eq(catalogCards.cardKey, cand.catalogKey)).get();
  if (row?.phash) return row.phash;
  if (!cand.imageUrl) return null;
  const file = path.join(opts.cacheDir, "catalog-images", `${sha256(Buffer.from(cand.imageUrl)).slice(0, 32)}.img`);
  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch {
    const res = await opts.fetch(cand.imageUrl);
    if (!res.ok) return null;
    buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
  }
  const h = await dHash(await artworkRegion(buf));
  db.update(catalogCards).set({ imagePhash: h }).where(eq(catalogCards.cardKey, cand.catalogKey)).run();
  return h;
}

/**
 * Secours par l'image : reclasse les candidats selon la distance entre l'illustration photographiée
 * et celle du catalogue (0 = identique, 128 = opposé). Sert aux cartes anciennes, promos et cas ambigus.
 */
export async function rerankByImage(
  db: Db,
  photo: Buffer,
  cands: CardCandidate[],
  opts: { fetch?: FetchLike; cacheDir: string },
): Promise<(CardCandidate & { imageDistance?: number })[]> {
  if (cands.length < 2) return cands;
  const mine = await dHash(await artworkRegion(photo));
  const scored = await Promise.all(
    cands.map(async (c) => {
      try {
        const h = await catalogHash(db, c, { fetch: opts.fetch ?? fetch, cacheDir: opts.cacheDir });
        if (!h) return { ...c };
        const d = hamming(mine, h);
        // Distance ≤ 20 sur 128 : très probablement la même illustration.
        const bonus = d <= IMAGE_MATCH_STRONG ? 0.3 : d <= 36 ? 0.1 : -0.1;
        return { ...c, imageDistance: d, score: Math.round(Math.max(0, Math.min(1, c.score + bonus)) * 1000) / 1000, reason: `${c.reason}, image ${d}/128` };
      } catch {
        return { ...c };
      }
    }),
  );
  return scored.sort((a, b) => b.score - a.score);
}
