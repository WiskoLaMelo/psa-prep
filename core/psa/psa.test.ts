import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db";
import { memDb, reading, seedReferenceCatalog } from "../test/helpers";
import { resolveIdentity } from "../identify/resolve";
import { confirmFound, importCerts, suggestCatalogMatches } from "./store";
import { resolvePsa } from "./resolve";
import { certLabel, detectGameLang } from "./cert-api";
import { psaItems, psaSets } from "../db/schema";
import { eq } from "drizzle-orm";

const CERTS: Record<string, unknown> = {
  "11111111": {
    PSACert: { CertNumber: "11111111", SpecID: 9001, Year: "2023", Brand: "POKEMON JAPANESE SV2a-POKEMON CARD 151", Category: "TCG CARDS", CardNumber: "201", Subject: "CHARIZARD ex", Variety: "SPECIAL ART RARE", CardGrade: "GEM MT 10" },
  },
  "22222222": {
    PSACert: { CertNumber: "22222222", SpecID: 9002, Year: "2023", Brand: "POKEMON SV 151", Category: "TCG CARDS", CardNumber: "006", Subject: "CHARIZARD ex", Variety: "", CardGrade: "MINT 9" },
  },
};

function fakeFetch(calls: string[]) {
  return async (url: string, init?: RequestInit) => {
    calls.push(url);
    expect((init?.headers as Record<string, string>).Authorization).toBe("bearer TOKEN");
    const cert = url.split("/").pop()!;
    const body = CERTS[cert];
    return new Response(JSON.stringify(body ?? { IsValidRequest: false, ServerMessage: "No data found" }), { status: 200 });
  };
}

let db: Db;
beforeEach(() => {
  db = memDb();
  seedReferenceCatalog(db);
});

describe("certificats PSA", () => {
  it("détecte jeu et langue depuis la marque", () => {
    expect(detectGameLang("POKEMON JAPANESE SV2a-POKEMON CARD 151")).toEqual({ game: "pokemon", lang: "ja" });
    expect(detectGameLang("ONE PIECE FRENCH OP05-AWAKENING")).toEqual({ game: "onepiece", lang: "fr" });
    expect(detectGameLang("POKEMON SV 151")).toEqual({ game: "pokemon", lang: "en" });
  });

  it("construit le libellé d'étiquette", () => {
    expect(certLabel({ Year: "2023", Brand: "POKEMON SV 151", CardNumber: "006", Subject: "CHARIZARD ex", Variety: "" })).toBe("2023 POKEMON SV 151 #006 CHARIZARD ex");
  });

  it("importe, met en cache et lie automatiquement au catalogue", async () => {
    const calls: string[] = [];
    const res = await importCerts(db, ["11111111", "22222222", "33333333", "11111111"], { token: "TOKEN", fetch: fakeFetch(calls), delayMs: 0 });
    expect(res.map((r) => r.status)).toEqual(["linked", "linked", "not_found"]);
    expect(res[0]!.cardKey).toBe("pokemon:ja:SV2a:201:base");
    expect(res[1]!.cardKey).toBe("pokemon:en:sv03.5:006:base");
    expect(calls).toHaveLength(3);

    // Deuxième import : rien n'est redemandé à l'API.
    const again = await importCerts(db, ["11111111"], { token: "TOKEN", fetch: fakeFetch(calls), delayMs: 0 });
    expect(again[0]!.status).toBe("cached");
    expect(calls).toHaveLength(3);
  });

  it("s'arrête net si le token est absent", async () => {
    const res = await importCerts(db, ["11111111", "22222222"], { delayMs: 0 });
    expect(res).toHaveLength(1);
    expect(res[0]!.status).toBe("error");
  });
});

describe("statuts vert / orange / rouge", () => {
  const ja201 = () => resolveIdentity(db, reading({ language: "ja", printed_name: "リザードンex", name_english: "Charizard ex", printed_number: "201/165", set_code: "SV2a" }));
  const ja006 = () => resolveIdentity(db, reading({ language: "ja", printed_name: "リザードンex", name_english: "Charizard ex", printed_number: "006/165", set_code: "SV2a" }));

  it("rouge sans aucune donnée PSA, avec Research Request pré-rédigée", () => {
    const r = resolvePsa(db, ja201());
    expect(r.status).toBe("red");
    expect(r.manualFields.subject).toBe("CHARIZARD EX");
    expect(r.researchRequest?.description).toMatch(/Japanese Pokémon card/);
    expect(r.searchStrings.length).toBeGreaterThan(1);
  });

  it("vert pour la carte d'un slab importé, orange pour une autre carte du même set", async () => {
    await importCerts(db, ["11111111"], { token: "TOKEN", fetch: fakeFetch([]), delayMs: 0 });
    const green = resolvePsa(db, ja201());
    expect(green.status).toBe("green");
    expect(green.title).toBe("2023 POKEMON JAPANESE SV2a-POKEMON CARD 151 #201 CHARIZARD ex SPECIAL ART RARE");
    expect(green.specId).toBe("9001");

    const orange = resolvePsa(db, ja006());
    expect(orange.status).toBe("orange");
    expect(orange.manualFields.brand).toBe("POKEMON JAPANESE SV2a-POKEMON CARD 151");
    expect(orange.manualFields.number).toBe("006");
    // Le catalogue japonais n'a pas encore de nom anglais : casse inconnue, majuscules par défaut.
    expect(orange.manualFields.subject).toBe("CHARIZARD EX");
    expect(orange.title).toBe("2023 POKEMON JAPANESE SV2a-POKEMON CARD 151 #006 CHARIZARD EX");
  });

  it("une confirmation utilisateur rend la carte verte et enrichit le set", async () => {
    await importCerts(db, ["11111111"], { token: "TOKEN", fetch: fakeFetch([]), delayMs: 0 });
    const id = ja006();
    confirmFound(db, id, { title: "2023 POKEMON JAPANESE SV2a-POKEMON CARD 151 #006 CHARIZARD ex", searchPattern: "{subject} {number}" });
    const r = resolvePsa(db, id);
    expect(r.status).toBe("green");
    expect(r.title).toBe("2023 POKEMON JAPANESE SV2a-POKEMON CARD 151 #006 CHARIZARD ex");
    const set = db.select().from(psaSets).get()!;
    const rules = JSON.parse(set.namingRulesJson);
    expect(rules.examples).toBe(2);
    expect(rules.searchWins["{subject} {number}"]).toBe(1);
    // Le sujet observé garde la casse PSA ("ex" en minuscules) : la règle l'apprend.
    expect(rules.subjectCase).toBe("upper_keep_lower");
    // Et la carte suivante du set profite de la casse apprise.
    const next = resolvePsa(db, { ...ja201(), cardKey: "pokemon:ja:SV2a:202:base", number: "202", name: "ピカチュウex", nameEn: "Pikachu ex" });
    expect(next.status).toBe("orange");
    expect(next.manualFields.subject).toBe("PIKACHU ex");
  });

  it("confirmer un titre sur un set inconnu crée le set PSA (source utilisateur)", () => {
    const id = ja201();
    confirmFound(db, id, { title: "2023 POKEMON JAPANESE SV2a-POKEMON CARD 151 #201 CHARIZARD ex SPECIAL ART RARE" });
    const item = db.select().from(psaItems).get()!;
    expect(item.source).toBe("user_confirmed");
    expect(item.numberPsa).toBe("201");
    expect(item.varietyPsa).toBe("SPECIAL ART RARE");
    expect(resolvePsa(db, id).status).toBe("green");
  });

  it("les saisies manuelles de l'utilisateur priment sur le calcul", () => {
    const r = resolvePsa(db, ja201(), { subject: "CHARIZARD ex", variety: "SAR" });
    expect(r.manualFields.subject).toBe("CHARIZARD ex");
    expect(r.manualFields.variety).toBe("SAR");
  });
});

describe("suggestCatalogMatches", () => {
  it("propose la bonne carte pour un item PSA non lié", async () => {
    await importCerts(db, ["22222222"], { token: "TOKEN", fetch: fakeFetch([]), delayMs: 0 });
    const item = db.select().from(psaItems).get()!;
    const set = db.select().from(psaSets).where(eq(psaSets.id, item.psaSetId)).get()!;
    const s = suggestCatalogMatches(db, item, set);
    expect(s[0]!.cardKey).toBe("pokemon:en:sv03.5:006:base");
  });
});
