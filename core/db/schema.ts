import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

const now = () => new Date().toISOString();

export const catalogSets = sqliteTable(
  "catalog_sets",
  {
    /** game:lang:set_id */
    key: text("key").primaryKey(),
    game: text("game").notNull(),
    lang: text("lang").notNull(),
    setId: text("set_id").notNull(),
    name: text("name").notNull(),
    series: text("series"),
    /** Codes imprimés sur la carte (ex. ["PAL"], ["SV2a"], ["OP05"]). */
    codesJson: text("codes_json").notNull().default("[]"),
    releaseDate: text("release_date"),
    cardCount: integer("card_count"),
    officialCount: integer("official_count"),
    source: text("source").notNull(),
    updatedAt: text("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("catalog_sets_game_lang").on(t.game, t.lang)],
);

export const catalogCards = sqliteTable(
  "catalog_cards",
  {
    /** game:lang:set_id:numero:variante */
    cardKey: text("card_key").primaryKey(),
    game: text("game").notNull(),
    lang: text("lang").notNull(),
    setId: text("set_id").notNull(),
    setName: text("set_name").notNull(),
    number: text("number").notNull(),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    variant: text("variant").notNull().default("base"),
    rarity: text("rarity"),
    imageUrl: text("image_url"),
    imagePhash: text("image_phash"),
    source: text("source").notNull(),
    updatedAt: text("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("catalog_cards_set_number").on(t.game, t.setId, t.number),
    index("catalog_cards_lang_number").on(t.game, t.lang, t.number),
  ],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const captures = sqliteTable(
  "captures",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    sessionItemId: integer("session_item_id"),
    side: text("side").notNull().default("front"),
    imagePath: text("image_path").notNull(),
    imageHash: text("image_hash").notNull(),
    width: integer("width"),
    height: integer("height"),
    /** pending | processing | done | error */
    status: text("status").notNull().default("pending"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    capturedAt: text("captured_at").notNull().$defaultFn(now),
  },
  (t) => [index("captures_session").on(t.sessionId), index("captures_status").on(t.status)],
);

/** Cache des lectures vision : une image déjà lue n'est jamais renvoyée à l'API. */
export const visionCache = sqliteTable("vision_cache", {
  imageHash: text("image_hash").primaryKey(),
  model: text("model").notNull(),
  rawJson: text("raw_json").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const identifications = sqliteTable("identifications", {
  captureId: integer("capture_id")
    .primaryKey()
    .references(() => captures.id, { onDelete: "cascade" }),
  cardKey: text("card_key"),
  confidence: real("confidence").notNull().default(0),
  candidatesJson: text("candidates_json").notNull().default("[]"),
  rawVisionJson: text("raw_vision_json"),
  identityJson: text("identity_json"),
  /** Appel vision réellement facturé pour cette capture (0 si servi par le cache). */
  visionCalls: integer("vision_calls").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  userCorrected: integer("user_corrected", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const psaSets = sqliteTable(
  "psa_sets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    game: text("game").notNull(),
    lang: text("lang").notNull(),
    /** Chaîne exacte du set chez PSA (champ Brand), ex. "POKEMON JAPANESE SV2a-POKEMON CARD 151". */
    psaSetString: text("psa_set_string").notNull(),
    year: text("year"),
    category: text("category"),
    namingRulesJson: text("naming_rules_json").notNull().default("{}"),
    source: text("source").notNull(),
    verifiedAt: text("verified_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("psa_sets_string_year").on(t.psaSetString, t.year)],
);

/** Lien set du catalogue → set PSA, appris des correspondances confirmées. */
export const psaSetLinks = sqliteTable(
  "psa_set_links",
  {
    catalogSetKey: text("catalog_set_key").notNull(),
    psaSetId: integer("psa_set_id")
      .notNull()
      .references(() => psaSets.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    confirmedAt: text("confirmed_at").notNull().$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.catalogSetKey, t.psaSetId] })],
);

export const psaItems = sqliteTable(
  "psa_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    psaSetId: integer("psa_set_id")
      .notNull()
      .references(() => psaSets.id, { onDelete: "cascade" }),
    specId: text("spec_id"),
    /** Titre exact tel qu'affiché dans le Online Submission Center (confirmé par l'utilisateur ou l'extension). */
    titleExact: text("title_exact"),
    /** Libellé reconstitué depuis le certificat (année marque #numéro sujet variété). */
    label: text("label").notNull(),
    numberPsa: text("number_psa").notNull().default(""),
    subjectPsa: text("subject_psa").notNull(),
    varietyPsa: text("variety_psa").notNull().default(""),
    source: text("source").notNull(),
    exampleCert: text("example_cert"),
    verifiedAt: text("verified_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("psa_items_identity").on(t.psaSetId, t.numberPsa, t.subjectPsa, t.varietyPsa),
    index("psa_items_spec").on(t.specId),
  ],
);

export const mappings = sqliteTable("mappings", {
  cardKey: text("card_key").primaryKey(),
  psaItemId: integer("psa_item_id")
    .notNull()
    .references(() => psaItems.id, { onDelete: "cascade" }),
  /** confirmed | rejected */
  status: text("status").notNull(),
  source: text("source").notNull(),
  confidence: real("confidence").notNull().default(1),
  confirmedAt: text("confirmed_at").notNull().$defaultFn(now),
});

export const certs = sqliteTable("certs", {
  certNumber: text("cert_number").primaryKey(),
  rawJson: text("raw_json"),
  psaItemId: integer("psa_item_id"),
  error: text("error"),
  fetchedAt: text("fetched_at").notNull().$defaultFn(now),
});

export const sessionItems = sqliteTable(
  "session_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** 1 = carte du dessus de la pile. */
    position: integer("position").notNull(),
    frontCaptureId: integer("front_capture_id"),
    backCaptureId: integer("back_capture_id"),
    cardKey: text("card_key"),
    identityJson: text("identity_json"),
    psaStatus: text("psa_status"),
    psaJson: text("psa_json"),
    /** Saisie manuelle de l'utilisateur sur les champs PSA (prioritaire sur le calcul). */
    manualOverridesJson: text("manual_overrides_json"),
    declaredValue: real("declared_value"),
    notes: text("notes"),
    updatedAt: text("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("session_items_session").on(t.sessionId, t.position)],
);
