import { describe, expect, it } from "vitest";
import { memDb } from "../test/helpers";
import { syncTcgdex } from "./tcgdex";
import { syncOnePiece, parseOnePieceId } from "./onepiece";
import { resolveIdentity } from "../identify/resolve";
import { reading } from "../test/helpers";
import { catalogStats } from "./store";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

function tcgdexFetch(hits: string[]) {
  return async (url: string) => {
    hits.push(url);
    const u = new URL(url);
    const [, , lang, , setId] = u.pathname.split("/");
    if (!setId) return json(lang === "ja" ? [{ id: "SV2a", name: "ポケモンカード151", cardCount: { total: 2 } }] : [{ id: "sv03.5", name: "151", cardCount: { total: 2, official: 165 } }]);
    if (lang === "ja")
      return json({ id: "SV2a", name: "ポケモンカード151", releaseDate: "2023-06-16", cardCount: { total: 2, official: 165 }, cards: [{ id: "SV2a-201", localId: "201", name: "リザードンex", image: "https://assets.tcgdex.net/ja/SV/SV2a/201" }, { id: "SV2a-001", localId: "001", name: "フシギダネ" }] });
    return json({
      id: "sv03.5",
      name: "151",
      releaseDate: "2023-09-22",
      serie: { id: "sv", name: "Scarlet & Violet" },
      abbreviation: { official: "MEW" },
      cardCount: { total: 2, official: 165 },
      cards: [
        { id: "sv03.5-001", localId: "001", name: lang === "fr" ? "Bulbizarre" : "Bulbasaur", image: `https://assets.tcgdex.net/${lang}/sv/sv03.5/001` },
        { id: "sv03.5-006", localId: "006", name: lang === "fr" ? "Dracaufeu-ex" : "Charizard ex" },
      ],
    });
  };
}

describe("synchronisation TCGdex", () => {
  it("remplit sets et cartes dans les trois langues, avec name_en en FR", async () => {
    const db = memDb();
    const hits: string[] = [];
    await syncTcgdex(db, { fetch: tcgdexFetch(hits) });
    const stats = catalogStats(db);
    expect(stats.map((s) => `${s.lang}:${s.cards}`)).toEqual(["en:2", "fr:2", "ja:2"]);
    const fr = resolveIdentity(db, reading({ language: "fr", printed_name: "Bulbizarre", printed_number: "001/165", set_code: "MEW" }));
    expect(fr.cardKey).toBe("pokemon:fr:sv03.5:001:base");
    expect(fr.nameEn).toBe("Bulbasaur");
    expect(fr.imageUrl).toBe("https://assets.tcgdex.net/fr/sv/sv03.5/001/low.webp");

    // Synchronisation suivante : aucun set inchangé n'est retéléchargé.
    const before = hits.length;
    await syncTcgdex(db, { fetch: tcgdexFetch(hits) });
    expect(hits.length - before).toBe(3);
  });
});

describe("synchronisation One Piece", () => {
  it("analyse les identifiants", () => {
    expect(parseOnePieceId("OP05-119_p1")).toEqual({ setId: "OP05", number: "119", variant: "p1" });
    expect(parseOnePieceId("EB01-001")).toEqual({ setId: "EB01", number: "001", variant: "base" });
    expect(parseOnePieceId("P-001")).toEqual({ setId: "P", number: "001", variant: "base" });
    expect(parseOnePieceId("n'importe quoi")).toBeNull();
  });

  it("importe les index Punk Records et ignore une langue vide", async () => {
    const db = memDb();
    const fetchOp = async (url: string) => {
      if (url.includes("/japanese/")) return json({});
      const fr = url.includes("/french/");
      if (url.endsWith("packs.json")) return json({ "569105": { id: "569105", raw_title: "x", title_parts: { prefix: "BOOSTER PACK", title: fr ? "L&apos;Éveil" : "Awakening of the New Era", label: "OP-05" } } });
      return json({
        "OP05-119": { card_id: "OP05-119", name: fr ? "Monkey D. Luffy" : "Monkey.D.Luffy", pack_id: "569105", rarity: "SecretRare", img_url: "https://x/OP05-119.png" },
        "OP05-119_p1": { card_id: "OP05-119_p1", name: fr ? "Monkey D. Luffy" : "Monkey.D.Luffy", pack_id: "569105", rarity: "SecretRare" },
      });
    };
    const summary = await syncOnePiece(db, { fetch: fetchOp });
    expect(summary).toEqual({ en: { sets: 1, cards: 2 }, fr: { sets: 1, cards: 2 }, ja: { sets: 0, cards: 0 } });
    const id = resolveIdentity(db, reading({ game: "onepiece", language: "fr", printed_name: "Monkey D. Luffy", printed_number: "OP05-119" }));
    expect(id.setName).toBe("BOOSTER PACK L'Éveil");
    expect(id.nameEn).toBe("Monkey.D.Luffy");
  });
});
