CREATE TABLE `captures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`session_item_id` integer,
	`side` text DEFAULT 'front' NOT NULL,
	`image_path` text NOT NULL,
	`image_hash` text NOT NULL,
	`width` integer,
	`height` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`captured_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `captures_session` ON `captures` (`session_id`);--> statement-breakpoint
CREATE INDEX `captures_status` ON `captures` (`status`);--> statement-breakpoint
CREATE TABLE `catalog_cards` (
	`card_key` text PRIMARY KEY NOT NULL,
	`game` text NOT NULL,
	`lang` text NOT NULL,
	`set_id` text NOT NULL,
	`set_name` text NOT NULL,
	`number` text NOT NULL,
	`name` text NOT NULL,
	`name_en` text,
	`variant` text DEFAULT 'base' NOT NULL,
	`rarity` text,
	`image_url` text,
	`image_phash` text,
	`source` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `catalog_cards_set_number` ON `catalog_cards` (`game`,`set_id`,`number`);--> statement-breakpoint
CREATE INDEX `catalog_cards_lang_number` ON `catalog_cards` (`game`,`lang`,`number`);--> statement-breakpoint
CREATE TABLE `catalog_sets` (
	`key` text PRIMARY KEY NOT NULL,
	`game` text NOT NULL,
	`lang` text NOT NULL,
	`set_id` text NOT NULL,
	`name` text NOT NULL,
	`series` text,
	`codes_json` text DEFAULT '[]' NOT NULL,
	`release_date` text,
	`card_count` integer,
	`official_count` integer,
	`source` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `catalog_sets_game_lang` ON `catalog_sets` (`game`,`lang`);--> statement-breakpoint
CREATE TABLE `certs` (
	`cert_number` text PRIMARY KEY NOT NULL,
	`raw_json` text,
	`psa_item_id` integer,
	`error` text,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `identifications` (
	`capture_id` integer PRIMARY KEY NOT NULL,
	`card_key` text,
	`confidence` real DEFAULT 0 NOT NULL,
	`candidates_json` text DEFAULT '[]' NOT NULL,
	`raw_vision_json` text,
	`identity_json` text,
	`vision_calls` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`user_corrected` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mappings` (
	`card_key` text PRIMARY KEY NOT NULL,
	`psa_item_id` integer NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`confirmed_at` text NOT NULL,
	FOREIGN KEY (`psa_item_id`) REFERENCES `psa_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `psa_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`psa_set_id` integer NOT NULL,
	`spec_id` text,
	`title_exact` text,
	`label` text NOT NULL,
	`number_psa` text DEFAULT '' NOT NULL,
	`subject_psa` text NOT NULL,
	`variety_psa` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`example_cert` text,
	`verified_at` text NOT NULL,
	FOREIGN KEY (`psa_set_id`) REFERENCES `psa_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `psa_items_identity` ON `psa_items` (`psa_set_id`,`number_psa`,`subject_psa`,`variety_psa`);--> statement-breakpoint
CREATE INDEX `psa_items_spec` ON `psa_items` (`spec_id`);--> statement-breakpoint
CREATE TABLE `psa_set_links` (
	`catalog_set_key` text NOT NULL,
	`psa_set_id` integer NOT NULL,
	`source` text NOT NULL,
	`confirmed_at` text NOT NULL,
	PRIMARY KEY(`catalog_set_key`, `psa_set_id`),
	FOREIGN KEY (`psa_set_id`) REFERENCES `psa_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `psa_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game` text NOT NULL,
	`lang` text NOT NULL,
	`psa_set_string` text NOT NULL,
	`year` text,
	`category` text,
	`naming_rules_json` text DEFAULT '{}' NOT NULL,
	`source` text NOT NULL,
	`verified_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `psa_sets_string_year` ON `psa_sets` (`psa_set_string`,`year`);--> statement-breakpoint
CREATE TABLE `session_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`position` integer NOT NULL,
	`front_capture_id` integer,
	`back_capture_id` integer,
	`card_key` text,
	`identity_json` text,
	`psa_status` text,
	`psa_json` text,
	`manual_overrides_json` text,
	`declared_value` real,
	`notes` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_items_session` ON `session_items` (`session_id`,`position`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vision_cache` (
	`image_hash` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`raw_json` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
