import type { Game, Lang } from "../types";

export interface CardKeyParts {
  game: Game;
  lang: Lang;
  setId: string;
  number: string;
  variant?: string | null;
}

const clean = (s: string) => s.trim().replace(/:/g, "-");

/** card_key = jeu:langue:set_id:numéro:variante */
export function makeCardKey(p: CardKeyParts): string {
  return [p.game, p.lang, clean(p.setId), clean(p.number), clean(p.variant || "base")].join(":");
}

export function parseCardKey(key: string): CardKeyParts & { variant: string } {
  const [game, lang, setId, number, variant] = key.split(":");
  if (!game || !lang || !setId || !number) throw new Error(`card_key invalide : ${key}`);
  return { game: game as Game, lang: lang as Lang, setId, number, variant: variant || "base" };
}

export function setKey(game: string, lang: string, setId: string): string {
  return `${game}:${lang}:${setId}`;
}

/** Même carte dans une autre langue (fiches TCGdex internationales et One Piece partagent leurs identifiants). */
export function withLang(key: string, lang: Lang): string {
  const p = parseCardKey(key);
  return makeCardKey({ ...p, lang });
}
