import { describe, expect, it } from "vitest";
import { applyNumber, applySubject, composeLabel, EMPTY_RULES, learnRules, parsePsaTitle, searchStrings } from "./naming";

const ex = (o: Partial<Parameters<typeof learnRules>[0][number]> = {}) => ({
  setId: "SV2a",
  catalogNumber: "201",
  catalogName: "リザードンex",
  catalogNameEn: "Charizard ex",
  variant: "base",
  psaNumber: "201",
  psaSubject: "CHARIZARD ex",
  psaVariety: "SPECIAL ART RARE",
  ...o,
});

describe("learnRules", () => {
  it("apprend le format de numéro, la langue et la casse du sujet", () => {
    const rules = learnRules([ex(), ex({ catalogNumber: "006", psaNumber: "006", catalogNameEn: "Bulbasaur", catalogName: "フシギダネ", psaSubject: "BULBASAUR", psaVariety: "" })]);
    expect(rules.numberFormat).toBe("as_catalog");
    expect(rules.subjectSource).toBe("en");
    expect(rules.examples).toBe(2);
  });

  it("détecte les numéros sans zéros et les sujets en langue locale", () => {
    const rules = learnRules([
      ex({ catalogNumber: "006", psaNumber: "6", catalogName: "Dracaufeu", catalogNameEn: "Charizard", psaSubject: "DRACAUFEU" }),
      ex({ catalogNumber: "012", psaNumber: "12", catalogName: "Papilusion", catalogNameEn: "Butterfree", psaSubject: "PAPILUSION" }),
    ]);
    expect(rules.numberFormat).toBe("strip_zeros");
    expect(rules.subjectSource).toBe("local");
    expect(["upper", "upper_keep_lower"]).toContain(rules.subjectCase);
    expect(applyNumber(rules, "x", "045")).toBe("45");
    expect(applySubject(rules, "Ectoplasma", "Gengar")).toBe("ECTOPLASMA");
  });

  it("détecte le préfixe de set One Piece", () => {
    const rules = learnRules([ex({ setId: "OP05", catalogNumber: "119", psaNumber: "OP05-119", catalogName: "Monkey.D.Luffy", catalogNameEn: "Monkey.D.Luffy", psaSubject: "MONKEY.D.LUFFY" })]);
    expect(rules.numberFormat).toBe("with_set_prefix");
    expect(applyNumber(rules, "OP05", "060")).toBe("OP05-060");
  });

  it("retient le vocabulaire de variété par variante", () => {
    const rules = learnRules([ex({ variant: "reverse", psaVariety: "REVERSE HOLO" }), ex({ variant: "base", psaVariety: "" })]);
    expect(rules.varieties).toEqual({ reverse: "REVERSE HOLO" });
    const two = learnRules([ex({ variant: "base", psaVariety: "" }), ex({ variant: "base", psaVariety: "" })]);
    expect(two.varieties).toEqual({ base: "" });
  });

  it("n'étend pas la variété d'une carte rare à tout le set", () => {
    const rules = learnRules([ex({ psaVariety: "SPECIAL ART RARE" }), ex({ catalogNumber: "006", psaNumber: "006", psaVariety: "" })]);
    expect(rules.varieties.base).toBeUndefined();
  });
});

describe("searchStrings", () => {
  const parts = { year: "2023", brand: "POKEMON JAPANESE SV2a-POKEMON CARD 151", number: "201", subject: "CHARIZARD ex", variety: "", setName: "151" };
  it("produit plusieurs variantes sans doublon", () => {
    const s = searchStrings(EMPTY_RULES, parts).map((x) => x.text);
    expect(s[0]).toBe("CHARIZARD ex #201 POKEMON JAPANESE SV2a-POKEMON CARD 151");
    expect(new Set(s).size).toBe(s.length);
  });
  it("place en tête le motif qui a déjà marché pour ce set", () => {
    const s = searchStrings({ ...EMPTY_RULES, searchWins: { "{subject} {number}": 3 } }, parts);
    expect(s[0]!.text).toBe("CHARIZARD ex #201");
  });
});

describe("parsePsaTitle", () => {
  it("découpe un titre de certificat", () => {
    expect(parsePsaTitle("2023 POKEMON JAPANESE SV2a-POKEMON CARD 151 #201 CHARIZARD ex SPECIAL ART RARE", { number: "201", name: "リザードンex", nameEn: "Charizard ex" })).toEqual({
      year: "2023",
      brand: "POKEMON JAPANESE SV2a-POKEMON CARD 151",
      number: "201",
      subject: "CHARIZARD ex",
      variety: "SPECIAL ART RARE",
    });
  });
  it("fonctionne sans dièse devant le numéro", () => {
    const p = parsePsaTitle("2023 Pokemon Sv 151 Charizard ex 199", { number: "199", name: "Charizard ex", nameEn: "Charizard ex" });
    expect(p.year).toBe("2023");
    expect(p.brand).toBe("Pokemon Sv 151");
    expect(p.subject).toBe("Charizard ex");
    expect(p.number).toBe("199");
  });
  it("recompose un libellé", () => {
    expect(composeLabel({ year: "2023", brand: "POKEMON SV 151", number: "6", subject: "CHARIZARD ex", variety: "" })).toBe("2023 POKEMON SV 151 #6 CHARIZARD ex");
  });
});
