# CLAUDE.md — décisions et conventions

À lire au début de chaque session, avec SPEC.md. Le cahier des charges donne les grandes lignes ; ce fichier consigne ce qui a été décidé en le réalisant. Tenir ce fichier à jour à chaque décision.

## Règles qui priment sur tout

- Rien n'est jamais validé ni payé automatiquement chez PSA. L'extension remplit, l'utilisateur relit, valide et paie. Aucun identifiant PSA n'est stocké ni saisi. Le garde-fou est dans `extension/src/guard.ts` ; ne jamais l'affaiblir.
- Pas de scraping de psacard.com. Sources PSA : l'API officielle (certificats) et les confirmations de l'utilisateur. `PSA_PAGES_FETCH_ENABLED` reste à false et rien ne l'utilise pour l'instant.
- Aucune convention de nommage PSA codée en dur : elles sont apprises set par set (`core/psa/naming.ts`). Les seules valeurs par défaut sont celles du statut rouge, présentées comme une proposition à vérifier.
- La précision avant le rappel : un vert exige une correspondance confirmée (`cert_api` ou `user_confirmed`) **et** une identité sûre (confiance ≥ 0,8, ou corrigée par l'utilisateur), voir `GREEN_MIN_CONFIDENCE` dans `core/session/service.ts`.
- Les secrets restent dans `.env`, jamais commités.

## Architecture

- `core/` : logique pure et testée, sans dépendance à Next.
  - `db/` : schéma Drizzle et migrations SQLite. Après une modification de `schema.ts` : `npm run db:generate`, puis commiter la migration.
  - `catalog/` : synchronisation TCGdex (`tcgdex.ts`) et One Piece (`onepiece.ts`), contrôle M0 (`check.ts`).
  - `identify/` : lecture vision (`vision.ts`, schéma `reading.ts`), analyse des numéros (`numbers.ts`), résolution catalogue (`resolve.ts`), hash perceptuel et secours image (`image.ts`, `image-match.ts`).
  - `psa/` : API certificats, règles de nommage, statuts vert/orange/rouge (`resolve.ts`), stockage et apprentissage (`store.ts`).
  - `session/` : sessions, captures, pipeline d'identification, file avec reprise, exports.
  - `capture/stability.ts` : logique de capture automatique, partagée avec l'écran de scan.
- `app/` : Next.js (App Router), écrans et routes API. `lib/server.ts` : base partagée et file d'identification.
- `extension/` : Chrome MV3. Tous les sélecteurs DOM dans `src/selectors.ts`. Le déroulé (`runner.ts`) est séparé de l'accès à la page (`dom-adapter.ts`) pour être testable.
- `scripts/cli.ts` : ligne de commande.

## Décisions prises

- **Stack** : celle du cahier des charges (TypeScript, Next.js 15, SQLite + Drizzle, sharp, zod, Vitest, extension MV3 construite avec esbuild). TypeScript est épinglé en 5.x, car Next 15 ne lit pas la configuration de TypeScript 7. La config Next est en `.mjs`.
- **card_key** = `jeu:langue:set_id:numéro:variante`, la langue étant **la langue réelle de la carte**. `catalogKey` désigne la fiche catalogue réellement utilisée : elle peut être anglaise si la fiche FR/JP manque.
- **Numéros** : ceux du catalogue (TCGdex `localId`, par ex. "006" ; One Piece sur 3 chiffres, par ex. "119"). La façon dont PSA écrit le numéro est apprise par set (`numberFormat`).
- **Variantes** : Pokémon `base`, `reverse`, `1st-edition`, `shadowless`, `prerelease`, `staff`, `stamp`, combinables avec `-`. One Piece : `base`, `p1`, `p2`… (suffixes officiels `_p1`). La variété PSA d'une carte de base n'est apprise que si au moins 2 exemples concordent, car elle dépend souvent de la rareté (SAR, AR…).
- **Casse du sujet PSA** : apprise par set ; `upper_keep_lower` donne « CHARIZARD ex ».
- **Modèle vision** : `claude-opus-5-5` par défaut, effort `medium`, sortie structurée zod via `client.beta.messages.parse`, avec le secours serveur en cas de refus (`fallbacks: "default"`). Modèle et effort se règlent dans `.env`.
- **Cache vision** par sha256 de l'image originale (`vision_cache`). La file d'identification vit en base (`captures.status`) et reprend au redémarrage.
- **Hash perceptuel** : dHash 128 bits sur la zone d'illustration ; distance ≤ 20 = même illustration.
- **Cartes hors catalogue** : si rien ne correspond mais que la lecture est nette (nom, numéro et code ≥ 0,8), l'identité vient de la lecture (`method: "reading"`, confiance plafonnée à `OFF_CATALOG_MAX_CONFIDENCE` = 0,6). Une identité confirmée ou corrigée par l'utilisateur est ajoutée au catalogue local (`source: "user"`, `learnCatalogCard`).
- **Référence par un slab** : un certificat peut être rattaché directement à une carte précise (`attachCert`), qu'il s'agisse d'un slab de l'utilisateur ou de quelqu'un d'autre. Un slab scanné est rattaché automatiquement si l'identité est sûre et si le sujet du certificat ressemble au nom de la carte (`subjectMatches` ≥ 0,6) ; sinon, avertissement.
- **Retour de gradation** : certificats collés dans l'ordre de la pile, rattachés position par position (`attachReturnedCerts`) ; une paire douteuse est signalée, jamais liée. C'est la réponse aux cartes sans pop : après leur premier passage, elles deviennent vertes.
- **Utilisateur non développeur** : tout doit pouvoir se faire sans terminal. Lanceurs à double-cliquer à la racine (`Lancer PSA Prep (Mac).command`, `(Windows).bat`, et leurs variantes « avec le téléphone », qui appellent `scripts/launch/`) : installation de Node.js, `npm install`, `.env`, démarrage et ouverture du navigateur. Page `/setup` (redirection automatique au premier lancement) : clé Anthropic vérifiée puis écrite dans `.env` (`core/env-file.ts`, uniquement depuis localhost), catalogues, test d'une photo, token PSA. Toujours accompagner l'utilisateur pas à pas.
- **Synchro des catalogues** : Pokémon et One Piece sont synchronisés indépendamment ; une source injoignable n'empêche pas l'autre et le message dit quel site est en cause.
- **Statuts PSA** stockés dans `session_items.psa_json` comme cache, recalculés au démarrage du serveur et après chaque import ou confirmation.

## Questions ouvertes du M0 : réponses retenues (à revoir avec l'utilisateur)

1. **Capture** : les deux options sont prises en charge. Webcam en `localhost` ; téléphone via `npm run phone` (certificat auto-signé couvrant les IP du réseau local, QR code dans le terminal et sur la page /phone) ou via un tunnel (cloudflared). Le logiciel ne tourne pas sur le téléphone : c'est un navigateur qui sert de caméra.
2. **Catalogue One Piece** : jeu de données ouvert Punk Records (github.com/buhbbl/punk-records), généré par vegapull depuis les sites officiels. Il couvre l'anglais et le français ; le dossier japonais est vide, donc les fiches `ja` viennent de l'édition « English Asia » (source `punk-records-asia`), qui suit les sorties japonaises et contient environ 400 cartes absentes de l'anglais. Les données sont © Eiichiro Oda/Shueisha, Toei Animation, Bandai ; le code du pipeline est sous AGPL. Usage personnel uniquement, données non redistribuées (rien n'est commité). Le nom japonais imprimé vient de la lecture.
3. **Pages de population PSA** : CGU non vérifiées, donc rien n'est implémenté et l'interrupteur reste à false.
4. **Valeur déclarée** : manuelle en v1.

## Points non vérifiés en conditions réelles (réseau bloqué pendant la construction)

- **Réponses de l'API TCGdex** (`/v2/{lang}/sets`, `/v2/{lang}/sets/{id}`, champ `abbreviation`) : forme supposée d'après la documentation, testée uniquement avec des réponses simulées. À la première synchro réelle, vérifier que `codes_json` des sets FR/EN contient bien les codes imprimés (MEW, PAL…) ; sinon, la résolution par code tombera sur « numéro + nom ».
- **Réponses de l'API PSA** (`/publicapi/cert/GetByCertNumber/{n}`, objet `PSACert`, en-tête `Authorization: bearer …`) : à vérifier avec un vrai token.
- **Prompt vision** : jamais exécuté contre la vraie API. Le premier `npm run eval` donnera la vraie mesure.
- **Sélecteurs du formulaire PSA** : heuristiques génériques. Les régler à partir d'une inspection réelle (bouton « Inspecter le formulaire » du popup) avant tout remplissage réel.
- **Synchro One Piece** : vérifiée pour de vrai (4 910 cartes EN, 2 950 FR ; contrôle 20/20). Édition English Asia : 4 914 cartes, dont 400 absentes de l'anglais.
- **Téléphone** : `npm run phone` testé ici (certificat couvrant l'IP réseau vérifié avec openssl, page servie via l'IP) ; écran de scan testé en émulation Android avec caméra simulée. Pas testé sur un vrai iPhone.

## Conventions de travail

- Avancer jalon par jalon et s'arrêter aux critères d'acceptation de SPEC.md.
- Tests Vitest pour toute logique de `core/` (en particulier la génération des libellés PSA) et de l'extension. `npm test` doit rester vert ; `npx tsc --noEmit` et `npx next build` aussi.
- Un commit par étape cohérente, message clair en français.
- En cas de doute sur une règle de nommage PSA : demander un exemple réel plutôt que supposer.
- Pour tester l'interface sans clé API : `VISION_MOCK_FILE=lecture.json npm run dev` renvoie une lecture fixe.
