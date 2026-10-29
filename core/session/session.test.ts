import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Db } from "../db";
import { memDb, reading, seedReferenceCatalog } from "../test/helpers";
import { addCapture, createSession, deleteItem, listItems, moveItem, patchItem, sessionCost, undoLastCapture } from "./service";
import { processCapture } from "./pipeline";
import { exportCsv, exportJson } from "./export";
import { IdentifyQueue } from "./queue";
import type { VisionReader } from "../identify/vision";
import type { VisionReading } from "../identify/reading";
import { parseCsv } from "../util/csv";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "psa-prep-test-"));

/** Fausse lecture : la couleur de l'image dit quelle carte c'est. */
const READINGS: Record<string, Partial<VisionReading>> = {
  red: { printed_name: "Charizard ex", printed_number: "006/165", set_code: "MEW" },
  blue: { game: "onepiece", language: "fr", printed_name: "Monkey D. Luffy", printed_number: "OP05-119" },
  green: { printed_name: "???", printed_number: null, confidence: { game: 0.5, language: 0.5, name: 0.1, number: 0.1, set_code: 0.1 } },
};
const COLORS = { red: { r: 200, g: 20, b: 20 }, blue: { r: 20, g: 20, b: 200 }, green: { r: 20, g: 200, b: 20 } };

async function photo(color: keyof typeof COLORS, seed = 0) {
  return sharp({ create: { width: 630 + seed, height: 880, channels: 3, background: COLORS[color] } }).jpeg().toBuffer();
}

function fakeVision(calls: { n: number }): VisionReader {
  return async (jpeg) => {
    calls.n++;
    const { dominant } = await sharp(jpeg).stats();
    const color = dominant.r > 150 ? "red" : dominant.b > 150 ? "blue" : "green";
    return { reading: reading(READINGS[color]!), model: "claude-opus-5-5", inputTokens: 1500, outputTokens: 300, costUsd: 0.012 };
  };
}

let db: Db;
beforeEach(() => {
  db = memDb();
  seedReferenceCatalog(db);
});

describe("session de scan", () => {
  it("garde l'ordre de la pile et identifie chaque carte", async () => {
    const s = createSession(db, "Test");
    const calls = { n: 0 };
    const deps = { vision: fakeVision(calls), imageFallback: false };
    for (const c of ["red", "blue", "green"] as const) {
      const { capture } = await addCapture(db, s.id, await photo(c));
      await processCapture(db, capture.id, deps).catch(() => {});
    }
    const items = listItems(db, s.id);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items[0]!.identity?.cardKey).toBe("pokemon:en:sv03.5:006:base");
    expect(items[0]!.psa?.status).toBe("red");
    expect(items[1]!.identity?.cardKey).toBe("onepiece:fr:OP05:119:base");
    expect(items[2]!.identity?.confidence).toBe(0);
    expect(sessionCost(db, s.id)).toEqual({ calls: 3, cost: expect.closeTo(0.036, 5) });
  });

  it("ne relit jamais deux fois la même image", async () => {
    const s = createSession(db);
    const calls = { n: 0 };
    const img = await photo("red");
    for (let i = 0; i < 2; i++) {
      const { capture } = await addCapture(db, s.id, img);
      await processCapture(db, capture.id, { vision: fakeVision(calls), imageFallback: false });
    }
    expect(calls.n).toBe(1);
    expect(sessionCost(db, s.id).calls).toBe(1);
    // Même carte deux fois : autorisé mais signalé.
    expect(listItems(db, s.id)[1]!.duplicateOf).toEqual([1]);
  });

  it("rattache le verso à la carte précédente", async () => {
    const s = createSession(db);
    await addCapture(db, s.id, await photo("red"));
    await addCapture(db, s.id, await photo("red", 1), "back");
    await addCapture(db, s.id, await photo("blue"));
    const items = listItems(db, s.id);
    expect(items).toHaveLength(2);
    expect(items[0]!.backCaptureId).not.toBeNull();
  });

  it("annule la dernière capture, supprime et réordonne", async () => {
    const s = createSession(db);
    for (const [i, c] of (["red", "blue", "green", "red"] as const).entries()) await addCapture(db, s.id, await photo(c, i));
    expect(undoLastCapture(db, s.id)).toBe(true);
    let items = listItems(db, s.id);
    expect(items).toHaveLength(3);
    moveItem(db, items[2]!.id, 1);
    items = listItems(db, s.id);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    const firstId = items[0]!.id;
    deleteItem(db, items[1]!.id);
    items = listItems(db, s.id);
    expect(items.map((i) => i.position)).toEqual([1, 2]);
    expect(items[0]!.id).toBe(firstId);
  });

  it("applique les corrections de la revue", async () => {
    const s = createSession(db);
    const { capture, item } = await addCapture(db, s.id, await photo("green"));
    await processCapture(db, capture.id, { vision: fakeVision({ n: 0 }), imageFallback: false });
    patchItem(db, item.id, { identity: { game: "pokemon", lang: "fr", setId: "sv03.5", setName: "151", number: "001", name: "Bulbizarre" }, declaredValue: 40, notes: "coin" });
    const it0 = listItems(db, s.id)[0]!;
    expect(it0.identity?.cardKey).toBe("pokemon:fr:sv03.5:001:base");
    expect(it0.identity?.method).toBe("manual");
    expect(it0.declaredValue).toBe(40);
    patchItem(db, item.id, { manualOverrides: { variety: "REVERSE HOLO" } });
    expect(listItems(db, s.id)[0]!.psa?.manualFields.variety).toBe("REVERSE HOLO");
  });

  it("exporte en CSV et JSON dans l'ordre de la pile", async () => {
    const s = createSession(db, "Export");
    for (const c of ["red", "blue"] as const) {
      const { capture } = await addCapture(db, s.id, await photo(c));
      await processCapture(db, capture.id, { vision: fakeVision({ n: 0 }), imageFallback: false });
    }
    const rows = parseCsv(exportCsv(db, s.id));
    expect(rows.map((r) => r.position)).toEqual(["1", "2"]);
    expect(rows[0]!.nom).toBe("Charizard ex");
    expect(rows[0]!.statut).toBe("set inconnu");
    const json = exportJson(db, s.id);
    expect(json.format).toBe("psa-prep-session");
    expect(json.items[1]!.manualFields?.number).toBe("119");
  });
});

describe("précision avant rappel", () => {
  it("n'affiche jamais en vert une carte dont l'identité est incertaine", async () => {
    const { confirmFound } = await import("../psa/store");
    const { resolveIdentity } = await import("../identify/resolve");
    const s = createSession(db);
    // Lecture ambiguë (nom lu différent du catalogue) mais carte déjà confirmée chez PSA.
    const r = { printed_name: "Charizord", printed_number: "006/165", set_code: "MEW", confidence: { game: 0.9, language: 0.9, name: 0.4, number: 0.5, set_code: 0.5 } };
    confirmFound(db, resolveIdentity(db, reading(r)), { title: "2023 POKEMON SV 151 #006 CHARIZARD ex" });
    const previous = READINGS.red;
    READINGS.red = r;
    const { capture, item } = await addCapture(db, s.id, await photo("red", 7));
    await processCapture(db, capture.id, { vision: fakeVision({ n: 0 }), imageFallback: false }).finally(() => (READINGS.red = previous));
    let it0 = listItems(db, s.id)[0]!;
    expect(it0.identity!.confidence).toBeLessThan(0.8);
    expect(it0.psa?.status).toBe("orange");
    expect(it0.psa?.title).toBe("2023 POKEMON SV 151 #006 CHARIZARD ex");
    // Une fois l'identité confirmée par l'utilisateur, le vert est rendu.
    patchItem(db, item.id, { candidateCardKey: it0.identity!.cardKey });
    it0 = listItems(db, s.id)[0]!;
    expect(it0.psa?.status).toBe("green");
  });
});

describe("file d'identification", () => {
  it("retente après une erreur réseau puis réussit", async () => {
    const s = createSession(db);
    const { capture } = await addCapture(db, s.id, await photo("red"));
    let n = 0;
    const flaky: VisionReader = async (jpeg) => {
      if (n++ === 0) throw new Error("fetch failed");
      return fakeVision({ n: 0 })(jpeg);
    };
    const q = new IdentifyQueue(db, { vision: flaky, imageFallback: false }, 1, 3);
    q.push(capture.id);
    for (let i = 0; i < 100 && listItems(db, s.id)[0]!.captureStatus !== "done"; i++) await new Promise((r) => setTimeout(r, 100));
    expect(listItems(db, s.id)[0]!.captureStatus).toBe("done");
  }, 15000);
});
