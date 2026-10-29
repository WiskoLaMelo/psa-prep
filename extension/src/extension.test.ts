import { describe, expect, it } from "vitest";
import { assertClickable, isForbiddenClick, isForbiddenField, type ElementLike } from "./guard";
import { pickResult } from "./match";
import { runSession, summarize, type PageAdapter } from "./runner";
import { DEFAULT_SELECTORS, mergeSelectors } from "./selectors";
import type { SessionExport, SessionExportItem } from "./types";

const el = (tag: string, text: string, attrs: Record<string, string> = {}): ElementLike => ({
  tagName: tag,
  textContent: text,
  getAttribute: (n) => attrs[n] ?? null,
  closest: () => null,
});

describe("garde-fou", () => {
  it.each(["Submit Order", "Pay now", "Checkout", "Confirm", "Valider la commande", "Payer", "Place order", "Sign in"])("refuse « %s »", (t) => {
    expect(isForbiddenClick(el("button", t))).toBe(true);
    expect(() => assertClickable(el("button", t))).toThrow(/garde-fou/);
  });
  it("refuse un input submit et les champs sensibles", () => {
    expect(isForbiddenClick(el("input", "", { type: "submit" }))).toBe(true);
    expect(isForbiddenField(el("input", "", { type: "password" }))).toBe(true);
    expect(isForbiddenField(el("input", "", { name: "cardNumber" }))).toBe(true);
    expect(isForbiddenField(el("input", "", { autocomplete: "cc-number" }))).toBe(true);
  });
  it("autorise l'ajout d'un item et la recherche", () => {
    expect(isForbiddenClick(el("button", "Add item"))).toBe(false);
    expect(isForbiddenClick(el("li", "2023 POKEMON JAPANESE SV2a #201 CHARIZARD ex"))).toBe(false);
    expect(isForbiddenField(el("input", "", { type: "search", name: "q" }))).toBe(false);
  });
});

describe("choix du résultat", () => {
  const titles = ["2023 Pokemon Japanese SV2a-Pokemon Card 151 #006 Charizard ex", "2023 POKEMON JAPANESE SV2a-POKEMON CARD 151 #201 CHARIZARD ex SPECIAL ART RARE"];
  it("trouve le titre exact malgré la casse et les espaces", () => {
    expect(pickResult(titles, { title: "2023 POKEMON JAPANESE SV2a-POKEMON CARD 151  #201 CHARIZARD ex special art rare" })).toEqual({ index: 1, exact: true });
  });
  it("sans titre exact, n'accepte qu'un résultat unique sujet + numéro", () => {
    expect(pickResult(titles, { title: null, subject: "CHARIZARD ex", number: "006" })).toEqual({ index: 0, exact: false });
    expect(pickResult(titles, { title: null, subject: "CHARIZARD ex", number: "999" })).toBeNull();
    expect(pickResult([...titles, "2023 POKEMON X #6 CHARIZARD ex"], { title: null, subject: "CHARIZARD ex", number: "6" })).toBeNull();
  });
});

function fakePage(results: string[], opts: { choose?: "continue" | "skip"; typed?: string[]; clicks?: string[] } = {}): PageAdapter {
  const typed = opts.typed ?? [];
  const clicks = opts.clicks ?? [];
  return {
    highlight: () => true,
    clearHighlights: () => {},
    fill: async (sel, v) => {
      typed.push(`${sel === DEFAULT_SELECTORS.searchInput ? "search" : "value"}:${v}`);
      return true;
    },
    click: async (sel) => {
      clicks.push(sel);
      return true;
    },
    readResults: () => results,
    chooseResult: async (_c, i) => void clicks.push(`result:${i}`),
    waitFor: async () => true,
    askUser: async () => ({ action: opts.choose ?? "continue", chosenTitle: opts.choose === "skip" ? null : "TITRE CHOISI" }),
    sleep: async () => {},
    progress: () => {},
  };
}

const item = (o: Partial<SessionExportItem>): SessionExportItem => ({
  itemId: 1,
  position: 1,
  cardKey: "pokemon:ja:SV2a:201:base",
  status: "green",
  title: "2023 POKEMON JAPANESE SV2a-POKEMON CARD 151 #201 CHARIZARD ex SPECIAL ART RARE",
  specId: null,
  searchStrings: ["CHARIZARD ex #201 POKEMON JAPANESE SV2a-POKEMON CARD 151"],
  manualFields: { year: "2023", brand: "POKEMON JAPANESE SV2a-POKEMON CARD 151", number: "201", subject: "CHARIZARD ex", variety: "" },
  declaredValue: 50,
  label: "Charizard ex",
  ...o,
});
const session = (items: SessionExportItem[]): SessionExport => ({ format: "psa-prep-session", version: 1, session: { id: "s", name: "Test", createdAt: "" }, items });
const cfg = mergeSelectors({ timing: { keystroke: 0, afterSearch: 0, resultsTimeout: 0, betweenItems: 0 } });

describe("déroulé de la session", () => {
  it("simulation : ne saisit rien et ne clique sur rien", async () => {
    const typed: string[] = [];
    const clicks: string[] = [];
    const r = await runSession(session([item({})]), fakePage([], { typed, clicks }), cfg, "simulation", { onConfirmed: async () => {}, shouldStop: () => false });
    expect(typed).toEqual([]);
    expect(clicks).toEqual([]);
    expect(r.items[0]!.outcome).toBe("simulated");
  });

  it("remplit un item vert sans intervention et renvoie le titre choisi", async () => {
    const typed: string[] = [];
    const confirmed: string[] = [];
    const titles = ["autre", "2023 POKEMON JAPANESE SV2a-POKEMON CARD 151 #201 CHARIZARD ex SPECIAL ART RARE"];
    const r = await runSession(session([item({})]), fakePage(titles, { typed }), cfg, "real", { onConfirmed: async (_i, t) => void confirmed.push(t), shouldStop: () => false });
    expect(r.items[0]!.outcome).toBe("filled");
    expect(typed).toEqual(["search:CHARIZARD ex #201 POKEMON JAPANESE SV2a-POKEMON CARD 151", "value:50"]);
    expect(confirmed).toEqual([titles[1]]);
  });

  it("met en pause sans correspondance exacte et respecte « Passer »", async () => {
    const r = await runSession(session([item({ title: null, status: "red" }), item({ position: 2, itemId: 2 })]), fakePage(["rien à voir"], { choose: "skip" }), cfg, "real", {
      onConfirmed: async () => {},
      shouldStop: () => false,
    });
    expect(r.items.map((i) => i.outcome)).toEqual(["skipped", "skipped"]);
    expect(summarize(r)).toMatch(/Rien n'a été validé ni payé/);
  });

  it("garde l'ordre de la pile et peut reprendre à une position", async () => {
    const order: number[] = [];
    const page = fakePage([]);
    page.progress = (_r, cur) => cur && order.push(cur.position);
    await runSession(session([item({ position: 3 }), item({ position: 1 }), item({ position: 2 })]), page, cfg, "simulation", { onConfirmed: async () => {}, shouldStop: () => false }, 2);
    expect(order).toEqual([2, 3]);
  });
});
