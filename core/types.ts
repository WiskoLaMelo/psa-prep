export const GAMES = ["pokemon", "onepiece"] as const;
export type Game = (typeof GAMES)[number];

export const LANGS = ["fr", "en", "ja"] as const;
export type Lang = (typeof LANGS)[number];

/** Provenance d'une information PSA. Seules cert_api et user_confirmed peuvent produire un vert. */
export type Source = "cert_api" | "user_confirmed" | "inferred";

export type PsaStatus = "green" | "orange" | "red";

export interface CardCandidate {
  catalogKey: string;
  cardKey: string;
  setId: string;
  setName: string;
  number: string;
  name: string;
  variant: string;
  imageUrl: string | null;
  score: number;
  reason: string;
}

/** Identité d'une carte, vérifiée contre le catalogue. */
export interface CardIdentity {
  game: Game;
  /** Langue réelle de la carte (celle imprimée). */
  lang: Lang;
  setId: string;
  setName: string;
  number: string;
  name: string;
  /** Nom anglais, utile pour les libellés PSA (qui utilisent souvent l'anglais). */
  nameEn: string | null;
  /** "base" si aucune variante particulière. */
  variant: string;
  /** Clé stable game:lang:set:numero:variante, dans la langue réelle. */
  cardKey: string;
  /** Clé de la fiche catalogue réellement utilisée (peut être en anglais si la fiche FR/JP manque). */
  catalogKey: string | null;
  releaseYear: number | null;
  imageUrl: string | null;
  /** 0 à 1. */
  confidence: number;
  method: "set_code" | "name_number" | "card_id" | "image" | "manual" | "none";
  candidates: CardCandidate[];
  warnings: string[];
}

export interface ManualFields {
  year: string;
  brand: string;
  number: string;
  subject: string;
  variety: string;
}

export interface PsaResolution {
  status: PsaStatus;
  reason: string;
  /** Titre PSA exact (vert) ou déduit (orange). */
  title: string | null;
  specId: string | null;
  psaItemId: number | null;
  psaSetId: number | null;
  searchStrings: string[];
  manualFields: ManualFields;
  /** Rouge uniquement : texte pré-rédigé pour une PSA Research Request. */
  researchRequest: { description: string; links: string[] } | null;
}
