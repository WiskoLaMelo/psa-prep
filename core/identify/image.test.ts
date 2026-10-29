import { describe, expect, it } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { dHash, hamming, prepareForVision } from "./image";
import { rerankByImage } from "./image-match";
import { memDb, seedCards } from "../test/helpers";
import type { CardCandidate } from "../types";

/** Fausse illustration : une mosaïque pseudo-aléatoire propre à chaque carte, avec un bruit optionnel. */
async function art(kind: "h" | "v", noise = 0) {
  const w = 300;
  const h = 420;
  let seed = kind === "h" ? 7 : 1234;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const blocks = Array.from({ length: 12 * 12 }, () => rand() * 255);
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = blocks[Math.floor((y / h) * 12) * 12 + Math.floor((x / w) * 12)]!;
      const i = (y * w + x) * 3;
      buf[i] = buf[i + 1] = buf[i + 2] = Math.max(0, Math.min(255, v + (((x * 7 + y * 13) % 11) - 5) * noise));
    }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe("hash perceptuel", () => {
  it("est proche pour la même image bruitée et loin pour une autre", async () => {
    const a = await dHash(await art("h"));
    const b = await dHash(await art("h", 2));
    const c = await dHash(await art("v"));
    expect(hamming(a, b)).toBeLessThan(16);
    expect(hamming(a, c)).toBeGreaterThan(40);
  });

  it("recadre une carte posée sur un fond sombre", async () => {
    const card = await sharp({ create: { width: 630, height: 880, channels: 3, background: { r: 230, g: 200, b: 60 } } }).png().toBuffer();
    const photo = await sharp({ create: { width: 1600, height: 1400, channels: 3, background: { r: 10, g: 10, b: 12 } } })
      .composite([{ input: card, left: 400, top: 250 }])
      .jpeg()
      .toBuffer();
    const r = await prepareForVision(photo);
    expect(r.cropped).toBe(true);
    expect(r.width / r.height).toBeCloseTo(630 / 880, 1);
  });
});

describe("secours par image", () => {
  it("départage deux candidats grâce à l'illustration", async () => {
    const db = memDb();
    seedCards(db, [
      { game: "pokemon", lang: "en", setId: "base1", setName: "Base Set", number: "4", name: "Charizard", imageUrl: "https://img/h" },
      { game: "pokemon", lang: "en", setId: "base4", setName: "Base Set 2", number: "4", name: "Charizard", imageUrl: "https://img/v" },
    ]);
    const cand = (setId: string, url: string): CardCandidate => ({
      catalogKey: `pokemon:en:${setId}:4:base`,
      cardKey: `pokemon:en:${setId}:4:base`,
      setId,
      setName: setId,
      number: "4",
      name: "Charizard",
      variant: "base",
      imageUrl: url,
      score: 0.6,
      reason: "test",
    });
    const images: Record<string, Buffer> = { "https://img/h": await art("h"), "https://img/v": await art("v") };
    const fakeFetch = async (url: string) => new Response(images[url]);
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "psa-img-"));
    const ranked = await rerankByImage(db, await art("v", 2), [cand("base1", "https://img/h"), cand("base4", "https://img/v")], { fetch: fakeFetch, cacheDir });
    expect(ranked[0]!.setId).toBe("base4");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });
});
