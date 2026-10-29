import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db";
import { memDb, reading, seedReferenceCatalog } from "../test/helpers";
import { pokemonVariant, resolveIdentity } from "./resolve";

let db: Db;
beforeEach(() => {
  db = memDb();
  seedReferenceCatalog(db);
});

describe("resolveIdentity — Pokémon", () => {
  it("trouve une carte récente par code d'extension + numéro", () => {
    const id = resolveIdentity(db, reading({ printed_name: "Charizard ex", printed_number: "006/165", set_code: "MEW" }));
    expect(id.cardKey).toBe("pokemon:en:sv03.5:006:base");
    expect(id.method).toBe("set_code");
    expect(id.confidence).toBeGreaterThan(0.9);
    expect(id.releaseYear).toBe(2023);
  });

  it("garde la langue réelle et la fiche FR quand elle existe", () => {
    const id = resolveIdentity(db, reading({ language: "fr", printed_name: "Dracaufeu-ex", printed_number: "006/165", set_code: "MEW" }));
    expect(id.cardKey).toBe("pokemon:fr:sv03.5:006:base");
    expect(id.catalogKey).toBe("pokemon:fr:sv03.5:006:base");
    expect(id.nameEn).toBe("Charizard ex");
  });

  it("se rabat sur la fiche anglaise quand la fiche FR manque, en gardant la langue FR", () => {
    const id = resolveIdentity(db, reading({ language: "fr", printed_name: "Magicarpe", name_english: "Magikarp", printed_number: "203/193", set_code: "PAL" }));
    expect(id.cardKey).toBe("pokemon:fr:sv02:203:base");
    expect(id.catalogKey).toBe("pokemon:en:sv02:203:base");
    expect(id.warnings.join(" ")).toMatch(/fiche anglaise/);
  });

  it("identifie une carte japonaise par son code SV2a", () => {
    const id = resolveIdentity(db, reading({ language: "ja", printed_name: "リザードンex", name_english: "Charizard ex", printed_number: "201/165", set_code: "SV2a" }));
    expect(id.cardKey).toBe("pokemon:ja:SV2a:201:base");
    expect(id.confidence).toBeGreaterThan(0.9);
  });

  it("utilise le total imprimé pour départager sans code", () => {
    const id = resolveIdentity(db, reading({ printed_name: "Charizard", printed_number: "4/102", set_code: null }));
    expect(id.setId).toBe("base1");
    expect(id.candidates.map((c) => c.setId)).toContain("base4");
  });

  it("baisse la confiance quand plusieurs cartes sont aussi probables", () => {
    const id = resolveIdentity(db, reading({ printed_name: "Charizard", printed_number: "4", set_code: null }));
    expect(id.candidates.length).toBeGreaterThan(1);
    expect(id.confidence).toBeLessThan(0.9);
    expect(id.warnings.join(" ")).toMatch(/Plusieurs cartes/);
  });

  it("ne donne jamais une confiance élevée quand le nom lu contredit le catalogue", () => {
    const id = resolveIdentity(db, reading({ printed_name: "Pikachu", printed_number: "006/165", set_code: "MEW" }));
    expect(id.confidence).toBeLessThan(0.9);
  });

  it("rend une identité vide et confiance 0 quand rien ne correspond et que la lecture est floue", () => {
    const id = resolveIdentity(db, reading({ printed_name: "Inconnu", printed_number: "999/999", set_code: "XXX", confidence: { game: 0.9, language: 0.9, name: 0.4, number: 0.5, set_code: 0.5 } }));
    expect(id.confidence).toBe(0);
    expect(id.catalogKey).toBeNull();
  });

  it("garde une carte hors catalogue (exclusivité JP) quand la lecture est nette, sans jamais la dire sûre", () => {
    const id = resolveIdentity(db, reading({ language: "ja", printed_name: "ピカチュウ", name_english: "Pikachu", printed_number: "001/SV-P", set_code: null }));
    expect(id.method).toBe("reading");
    expect(id.cardKey).toBe("pokemon:ja:SV-P:001:base");
    expect(id.confidence).toBeLessThanOrEqual(0.6);
    expect(id.warnings.join(" ")).toMatch(/absente du catalogue/);
  });

  it("déduit la variante des tampons et indices", () => {
    expect(pokemonVariant(reading({ variant_hints: ["reverse_holo"] }))).toBe("reverse");
    expect(pokemonVariant(reading({ stamps: ["1st Edition"], variant_hints: ["shadowless"] }))).toBe("1st-edition-shadowless");
    expect(pokemonVariant(reading({}))).toBe("base");
  });
});

describe("resolveIdentity — One Piece", () => {
  it("retrouve la carte par identifiant universel, en français", () => {
    const id = resolveIdentity(db, reading({ game: "onepiece", language: "fr", printed_name: "Monkey D. Luffy", printed_number: "OP05-119" }));
    expect(id.cardKey).toBe("onepiece:fr:OP05:119:base");
    expect(id.confidence).toBeGreaterThan(0.85);
  });

  it("choisit la parallèle quand la lecture le signale", () => {
    const id = resolveIdentity(db, reading({ game: "onepiece", printed_name: "Monkey.D.Luffy", printed_number: "OP05-119", variant_hints: ["parallel"] }));
    expect(id.variant).toBe("p1");
    expect(id.cardKey).toBe("onepiece:en:OP05:119:p1");
  });

  it("utilise la fiche anglaise pour une carte japonaise", () => {
    const id = resolveIdentity(db, reading({ game: "onepiece", language: "ja", printed_name: "モンキー・D・ルフィ", name_english: "Monkey.D.Luffy", printed_number: "OP05-119" }));
    expect(id.cardKey).toBe("onepiece:ja:OP05:119:base");
    expect(id.catalogKey).toBe("onepiece:en:OP05:119:base");
    expect(id.name).toBe("モンキー・D・ルフィ");
  });
});
