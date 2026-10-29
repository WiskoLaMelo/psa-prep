import { describe, expect, it } from "vitest";
import { numberForms, parseOnePieceNumber, parsePokemonNumber } from "./numbers";

describe("parsePokemonNumber", () => {
  it.each([
    ["151/165", { number: "151", total: "165", embeddedCode: null }],
    ["006/165", { number: "006", total: "165", embeddedCode: null }],
    ["SV2a 201/165", { number: "201", total: "165", embeddedCode: "SV2a" }],
    ["TG12/TG30", { number: "TG12", total: "TG30", embeddedCode: null }],
    ["SWSH050", { number: "SWSH050", total: null, embeddedCode: "SWSH" }],
    ["SVP 085", { number: "085", total: null, embeddedCode: "SVP" }],
    ["085/SV-P", { number: "085", total: null, embeddedCode: "SV-P" }],
    ["SM60", { number: "SM60", total: null, embeddedCode: "SM" }],
    ["4/102", { number: "4", total: "102", embeddedCode: null }],
  ])("%s", (raw, expected) => {
    expect(parsePokemonNumber(raw)).toEqual(expected);
  });

  it("renvoie null sur une chaîne vide ou illisible", () => {
    expect(parsePokemonNumber(null)).toBeNull();
    expect(parsePokemonNumber("???")).toBeNull();
  });
});

describe("numberForms", () => {
  it("propose les formes avec et sans zéros", () => {
    expect(numberForms("006")).toEqual(expect.arrayContaining(["006", "6", "06"]));
    expect(numberForms("4")).toEqual(expect.arrayContaining(["4", "04", "004"]));
    expect(numberForms("TG07")).toEqual(expect.arrayContaining(["TG07", "TG7", "TG007"]));
  });
});

describe("parseOnePieceNumber", () => {
  it("lit l'identifiant universel", () => {
    expect(parseOnePieceNumber("OP05-119", null)).toEqual({ setId: "OP05", number: "119" });
    expect(parseOnePieceNumber("st10 - 1", null)).toEqual({ setId: "ST10", number: "001" });
    expect(parseOnePieceNumber("P-001", null)).toEqual({ setId: "P", number: "001" });
  });
  it("recompose code + numéro lus séparément", () => {
    expect(parseOnePieceNumber("119", "OP05")).toEqual({ setId: "OP05", number: "119" });
  });
});
