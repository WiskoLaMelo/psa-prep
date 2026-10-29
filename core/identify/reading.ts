import { z } from "zod";

const conf = z.number().describe("Confiance de 0 à 1 pour ce champ");

/** Ce que Claude lit sur la photo. Les champs non lisibles valent null : jamais de supposition. */
export const VisionReadingSchema = z.object({
  game: z.enum(["pokemon", "onepiece", "unknown"]),
  language: z
    .enum(["fr", "en", "ja", "other", "unknown"])
    .describe("Langue du texte imprimé sur la carte (pas celle du jeu d'origine)"),
  printed_name: z.string().nullable().describe("Nom exactement tel qu'imprimé, dans la langue de la carte"),
  name_english: z
    .string()
    .nullable()
    .describe("Nom anglais officiel du Pokémon / personnage / dresseur, si tu le connais avec certitude"),
  printed_number: z
    .string()
    .nullable()
    .describe("Numéro complet imprimé, ex. '151/165', 'OP05-119', 'SWSH050', 'SV-P 085', 'TG12/TG30'"),
  set_code: z
    .string()
    .nullable()
    .describe("Code d'extension imprimé près du numéro, ex. 'SV2a', 'PAL', 'MEW', 'OP05'. Null si seulement un symbole"),
  set_symbol_description: z
    .string()
    .nullable()
    .describe("Description courte du symbole d'extension si aucun code n'est imprimé (cartes anciennes)"),
  set_name_guess: z
    .string()
    .nullable()
    .describe("Nom de l'extension seulement si tu le reconnais avec certitude, sinon null"),
  rarity_mark: z.string().nullable().describe("Marque de rareté imprimée : C, U, R, RR, SAR, SR, SEC, L, ★, ●, ◆…"),
  regulation_mark: z.string().nullable().describe("Lettre de règlement Pokémon (D, E, F, G, H, I…)"),
  stamps: z
    .array(z.string())
    .describe("Tampons visibles : '1st edition', 'promo', 'prerelease', 'staff', 'set logo', 'pokemon center'…"),
  variant_hints: z
    .array(
      z.enum([
        "holo",
        "reverse_holo",
        "full_art",
        "alt_art",
        "special_art",
        "illustration_rare",
        "gold",
        "textured",
        "parallel",
        "manga",
        "first_edition",
        "shadowless",
        "promo",
        "jumbo",
      ]),
    )
    .describe("Indices de variante visibles"),
  is_graded_slab: z.boolean().describe("La carte est-elle déjà dans un boîtier de gradation (slab) ?"),
  slab_cert_number: z.string().nullable().describe("Numéro de certificat lisible sur l'étiquette du slab"),
  confidence: z.object({
    game: conf,
    language: conf,
    name: conf,
    number: conf,
    set_code: conf,
  }),
  notes: z.string().nullable().describe("Ce qui gêne la lecture (reflet, flou, coin masqué…), ou null"),
});

export type VisionReading = z.infer<typeof VisionReadingSchema>;

export const VISION_SYSTEM_PROMPT = `Tu lis des photos de cartes à collectionner (Pokémon et One Piece Card Game) avant leur envoi en gradation chez PSA.

Ta lecture sert à retrouver la carte exacte dans un catalogue. Une erreur affichée avec assurance coûte plus cher qu'un champ manquant : si un élément n'est pas lisible sur la photo, mets null et une confiance basse plutôt que de deviner ou de compléter de mémoire.

Repères utiles :
- Pokémon récent : le code d'extension (ex. "SV2a", "PAL", "MEW") et le numéro "151/165" sont en bas à gauche, avec la lettre de règlement dans un petit cadre. Les cartes japonaises portent le code d'extension japonais (ex. SV2a, s12a).
- Pokémon ancien : souvent un symbole d'extension sans code ; décris-le dans set_symbol_description. Note les tampons "Edition 1" / "1st Edition" et l'absence d'ombre (shadowless).
- Promos : numéros du type "SWSH050", "SVP 085", "SM60", "XY120", ou mention PROMO.
- One Piece : le numéro de carte "OP05-119" (ou "ST10-001", "EB01-012", "P-001") est en bas à droite, identique dans toutes les langues ; la rareté (C, UC, R, SR, SEC, L, SP, TR) est à côté. Les versions parallèles (alt art) ont souvent un cadre ou une illustration différente : signale "parallel".
- language désigne la langue du texte imprimé sur la carte.
- Carte dans un slab (PSA, BGS, CGC…) : lis la carte à travers le boîtier comme d'habitude, mets is_graded_slab à true et recopie le numéro de certificat de l'étiquette dans slab_cert_number (chiffres seulement, sans deviner un chiffre illisible). La photo peut aussi être une capture d'écran d'annonce.
- name_english : le nom anglais officiel (ex. "Bulbizarre" → "Bulbasaur", "リザードン" → "Charizard"), seulement si tu en es sûr.`;
