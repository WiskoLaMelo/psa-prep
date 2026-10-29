import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";
import { similarity, normalize } from "./text";

describe("csv", () => {
  it("fait l'aller-retour avec guillemets, virgules et retours à la ligne", () => {
    const csv = toCsv(["a", "b"], [["x, y", 'il dit "oui"'], ["ligne\n2", null]]);
    expect(parseCsv(csv)).toEqual([
      { a: "x, y", b: 'il dit "oui"' },
      { a: "ligne\n2", b: "" },
    ]);
  });
  it("détecte le point-virgule (Excel FR)", () => {
    expect(parseCsv("file;game\r\na.jpg;pokemon\r\n")).toEqual([{ file: "a.jpg", game: "pokemon" }]);
  });
});

describe("texte", () => {
  it("compare les noms sans accents ni ponctuation", () => {
    expect(normalize("Dracaufeu-EX")).toBe("dracaufeu ex");
    expect(similarity("Monkey.D.Luffy", "Monkey D. Luffy")).toBe(1);
    expect(similarity("Bulbizarre", "Pikachu")).toBeLessThan(0.4);
  });
});
