import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Db } from "../db";
import { memDb, reading, seedReferenceCatalog } from "../test/helpers";
import { addCapture, createSession, listItems, patchItem } from "./service";
import { processCapture } from "./pipeline";
import { attachCert, attachReturnedCerts } from "../psa/store";
import { resolveIdentity } from "../identify/resolve";
import { resolvePsa } from "../psa/resolve";
import type { VisionReader } from "../identify/vision";
import type { VisionReading } from "../identify/reading";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "psa-prep-ref-"));

const CERTS: Record<string, object> = {
  "50000001": { CertNumber: "50000001", SpecID: 777, Year: "2023", Brand: "POKEMON SV 151", CardNumber: "006", Subject: "CHARIZARD ex", Variety: "" },
  "50000002": { CertNumber: "50000002", SpecID: 778, Year: "2023", Brand: "POKEMON SV 151", CardNumber: "001", Subject: "BULBASAUR", Variety: "" },
  "50000003": { CertNumber: "50000003", SpecID: 779, Year: "2023", Brand: "POKEMON JAPANESE SV-P PROMO", CardNumber: "001", Subject: "PIKACHU", Variety: "" },
};
const psaFetch = async (url: string) => {
  const c = CERTS[url.split("/").pop()!];
  return new Response(JSON.stringify(c ? { PSACert: c } : { IsValidRequest: false }), { status: 200 });
};

let counter = 0;
const photo = async () => sharp({ create: { width: 630, height: 880, channels: 3, background: { r: (counter++ * 37) % 255, g: 90, b: 40 } } }).jpeg().toBuffer();
const vision = (r: Partial<VisionReading>): VisionReader => async () => ({ reading: reading(r), model: "test", inputTokens: 0, outputTokens: 0, costUsd: 0 });

let db: Db;
beforeEach(() => {
  db = memDb();
  seedReferenceCatalog(db);
});

describe("référence par un slab", () => {
  it("un slab scanné rattache son certificat à la carte identifiée : vert direct", async () => {
    const s = createSession(db);
    const { capture } = await addCapture(db, s.id, await photo());
    const deps = { vision: vision({ printed_name: "Charizard ex", printed_number: "006/165", set_code: "MEW", is_graded_slab: true, slab_cert_number: "50000001" }), imageFallback: false, psaToken: "T", fetch: psaFetch };
    await processCapture(db, capture.id, deps);
    const it0 = listItems(db, s.id)[0]!;
    expect(it0.psa?.status).toBe("green");
    expect(it0.psa?.title).toBe("2023 POKEMON SV 151 #006 CHARIZARD ex");
    expect(it0.psa?.specId).toBe("777");
  });

  it("refuse de rattacher un certificat qui ne correspond pas à la carte", async () => {
    const s = createSession(db);
    const { capture } = await addCapture(db, s.id, await photo());
    const deps = { vision: vision({ printed_name: "Charizard ex", printed_number: "006/165", set_code: "MEW", is_graded_slab: true, slab_cert_number: "50000002" }), imageFallback: false, psaToken: "T", fetch: psaFetch };
    await processCapture(db, capture.id, deps);
    const it0 = listItems(db, s.id)[0]!;
    expect(it0.psa?.status).not.toBe("green");
    expect(it0.identity?.warnings.join(" ")).toMatch(/ne ressemble pas/);
  });

  it("sans token, prévient au lieu d'échouer", async () => {
    const s = createSession(db);
    const { capture } = await addCapture(db, s.id, await photo());
    await processCapture(db, capture.id, { vision: vision({ printed_name: "Charizard ex", printed_number: "006/165", set_code: "MEW", is_graded_slab: true, slab_cert_number: "50000001" }), imageFallback: false, psaToken: null });
    expect(listItems(db, s.id)[0]!.identity?.warnings.join(" ")).toMatch(/PSA_API_TOKEN/);
  });

  it("le slab de quelqu'un d'autre donne la référence d'une carte introuvable en recherche", async () => {
    const id = resolveIdentity(db, reading({ language: "ja", printed_name: "ピカチュウ", name_english: "Pikachu", printed_number: "001/SV-P" }));
    expect(resolvePsa(db, id).status).toBe("red");
    await attachCert(db, "50000003", id.cardKey, { token: "T", fetch: psaFetch });
    const r = resolvePsa(db, id);
    expect(r.status).toBe("green");
    expect(r.title).toBe("2023 POKEMON JAPANESE SV-P PROMO #001 PIKACHU");
  });
});

describe("retour de gradation", () => {
  it("rattache les certificats dans l'ordre de la pile et signale les paires douteuses", async () => {
    const charizard = resolveIdentity(db, reading({ printed_name: "Charizard ex", printed_number: "006/165", set_code: "MEW" }));
    const bulbasaur = resolveIdentity(db, reading({ printed_name: "Bulbasaur", printed_number: "001/165", set_code: "MEW" }));
    const items = [
      { position: 1, identity: charizard },
      { position: 2, identity: bulbasaur },
      { position: 3, identity: charizard },
    ];
    const res = await attachReturnedCerts(db, items, ["50000001", "50000002", "50000002"], { token: "T", fetch: psaFetch, delayMs: 0 });
    expect(res.map((r) => r.status)).toEqual(["linked", "linked", "mismatch"]);
    expect(resolvePsa(db, bulbasaur).status).toBe("green");
  });
});

describe("cartes hors catalogue", () => {
  it("une carte confirmée rejoint le catalogue et est retrouvée au scan suivant", async () => {
    const s = createSession(db);
    const r = { language: "ja" as const, printed_name: "ピカチュウ", name_english: "Pikachu", printed_number: "001/SV-P" };
    const first = await addCapture(db, s.id, await photo());
    await processCapture(db, first.capture.id, { vision: vision(r), imageFallback: false, psaToken: null });
    let it0 = listItems(db, s.id)[0]!;
    expect(it0.identity?.method).toBe("reading");
    patchItem(db, first.item.id, { confirmIdentity: true });
    it0 = listItems(db, s.id)[0]!;
    expect(it0.identity?.method).toBe("manual");
    expect(it0.identity?.catalogKey).toBe("pokemon:ja:SV-P:001:base");

    const again = resolveIdentity(db, reading({ ...r, set_code: "SV-P" }));
    expect(again.method).toBe("set_code");
    expect(again.catalogKey).toBe("pokemon:ja:SV-P:001:base");
  });
});
