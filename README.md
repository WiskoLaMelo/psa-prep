# psa-prep

Outil local qui transforme une pile de cartes scannées (Pokémon et One Piece, en FR, EN et JP) en submission PSA prête. Pour chaque carte, dans l'ordre de la pile, il donne la référence exacte à saisir chez PSA. Une extension Chrome remplit ensuite le formulaire du PSA Online Submission Center, sans jamais valider ni payer.

- **Cahier des charges** : [SPEC.md](SPEC.md) (les grandes lignes du projet)
- **Décisions et conventions** : [CLAUDE.md](CLAUDE.md)

## Ce que fait l'outil

1. **Scan** : tu fais défiler tes cartes sous la caméra. Chaque carte est capturée automatiquement dès que l'image est stable, puis l'outil attend que tu changes de carte.
2. **Identification** : Claude lit la photo (nom, numéro, code d'extension, langue, tampons, variante). La lecture est ensuite **vérifiée contre un catalogue local** : TCGdex pour Pokémon, les données officielles One Piece. Pour les cartes anciennes et les promos, l'illustration est comparée à celles du catalogue.
3. **Correspondance PSA** : chaque carte reçoit un statut.
   - 🟢 **Vert, confirmé** : le titre PSA exact est connu (via un de tes certificats ou une confirmation) et la carte est identifiée avec certitude.
   - 🟠 **Orange, déduit** : le set est connu chez PSA mais pas cette carte. Le libellé est déduit des règles apprises sur ce set.
   - 🔴 **Rouge, set inconnu** : l'outil donne des champs de saisie manuelle et une PSA Research Request pré-rédigée.
4. **Revue** : tu corriges, tu choisis parmi les candidats, tu copies les recherches et tu indiques la valeur déclarée. Chaque titre trouvé chez PSA devient une correspondance confirmée, et l'outil s'améliore à chaque submission.
5. **Exports** : CSV, liste imprimable dans l'ordre de la pile, JSON pour l'extension.
6. **Extension Chrome** : elle rejoue la session dans ton compte PSA déjà connecté, item par item, à rythme humain. Elle s'arrête avant toute validation.

## Installation

Prérequis : Node.js 20 ou plus récent, Google Chrome, une clé API Anthropic et un token PSA Public API.

```bash
npm install
```

```bash
cp .env.example .env
```

Renseigne `ANTHROPIC_API_KEY` et `PSA_API_TOKEN` dans `.env`. Les autres variables sont documentées dans `.env.example`.

```bash
npm run catalog:sync
```

La première synchronisation prend quelques minutes. Elle télécharge le catalogue Pokémon TCGdex (fr, en, ja) et One Piece (fr, en). Relance-la de temps en temps : seuls les sets nouveaux ou modifiés sont retéléchargés.

```bash
npm run cli -- catalog:check
```

Ce contrôle vérifie que 10 cartes par langue sont bien retrouvées par code + numéro.

```bash
npm run dev
```

Puis ouvre http://localhost:3000.

## Importer tes slabs (fortement conseillé)

Chaque certificat PSA que tu possèdes donne le libellé exact d'une carte et apprend à l'outil comment PSA nomme ce set. Crée un fichier `certs.txt` avec un numéro par ligne, puis lance :

```bash
npm run certs:import
```

Tu peux aussi coller les numéros dans la page **Correspondances PSA**. Les réponses de l'API sont gardées à vie : un certificat n'est jamais redemandé. L'offre gratuite PSA est limitée à environ 100 appels par jour. Les items que l'outil n'a pas pu relier seul au catalogue apparaissent dans **Correspondances PSA → Items à relier**, avec des suggestions.

## Scanner une pile

**Installation physique** : la caméra est fixée à la verticale au-dessus d'un fond mat sombre, avec une lumière diffuse sur les côtés. Les cartes sont nues ou en penny sleeve. Jamais de scanner à chargeur.

1. Accueil → **Nouvelle session et scanner** (une session = une submission).
2. Vise le fond sans carte et clique **Mémoriser le fond vide** : la capture ne se déclenchera jamais sur le fond seul.
3. Pose les cartes une par une, la carte du dessus de la pile en premier. Un bip confirme chaque capture.
   - `Espace` : capture manuelle
   - `Z` : annuler la dernière capture
   - `A` : activer ou couper la capture automatique
   - option **Recto/verso** : deux photos par carte, comme preuve d'état
4. **Terminer → revue**.

Si le réseau coupe, la capture continue. Les photos partent dans l'ordre dès que la connexion revient, et l'identification est relancée automatiquement.

### Avec le téléphone comme caméra

Le logiciel tourne sur l'ordinateur. Le téléphone ne sert que de caméra et d'écran, via son navigateur : il n'y a rien à installer dessus.

```bash
npm run phone
```

La commande lance l'application en HTTPS et affiche un **QR code** dans le terminal. La page **Téléphone** de l'application l'affiche aussi.

1. Mets le téléphone et l'ordinateur sur le même Wi-Fi.
2. Scanne le QR code avec l'appareil photo du téléphone.
3. La première fois, accepte l'avertissement de certificat. Sur Android/Chrome : « Paramètres avancés » → « Continuer vers le site ». Sur iPhone/Safari : « Afficher les détails » → « visiter ce site web ».
4. Si la page ne s'ouvre pas, autorise Node.js dans le pare-feu de l'ordinateur.

Sur le téléphone, touche l'image pour capturer à la main. L'écran ne se met pas en veille pendant le scan. Tu peux suivre la revue en même temps sur l'ordinateur.

**Si la caméra reste bloquée** (certains iPhone refusent un certificat local), passe par un tunnel. Il donne une vraie adresse HTTPS, même hors de ton Wi-Fi :

```bash
cloudflared tunnel --url http://localhost:3000
```

Ouvre l'adresse `https://….trycloudflare.com` affichée. Le tunnel expose l'application sur Internet : coupe-le après le scan.

## La revue

- Le filtre **À traiter seulement** n'affiche que les cartes oranges, rouges ou incertaines.
- **Corriger** : modifie n'importe quel champ de l'identité. **Autres cartes possibles** : choisis le bon candidat.
- **Recherches PSA** : plusieurs variantes classées, chacune copiable. La recherche PSA est sensible à l'ordre des mots.
- **Champs de saisie manuelle** (année, set, numéro, nom, variété) : chacun est copiable et modifiable. Tes modifications priment.
- **Trouvé chez PSA** : colle le titre exact affiché par le Submission Center, et indique si possible quelle recherche a fonctionné. La carte passe en vert, et les autres cartes du même set en profitent aussitôt.
- Les doublons sont signalés mais autorisés.
- Valeur déclarée et notes : saisie manuelle en v1.

## Cartes introuvables, exclusivités et cartes sans pop

### Cartes absentes du catalogue (exclusivités JP, promos récentes)

Aucun catalogue n'est complet, surtout en japonais. Quand Claude lit nettement une carte que le catalogue ne connaît pas, l'outil ne bloque pas : il construit l'identité à partir de la lecture, avec une confiance plafonnée à 60 % et l'avertissement « Carte absente du catalogue ». Vérifie-la, puis clique **Confirmer l'identité** (ou **Corriger**). La carte rejoint alors le catalogue local et sera retrouvée directement aux prochains scans.

- **One Piece en japonais** : l'outil utilise l'édition « English Asia ». Elle suit les sorties japonaises avec les mêmes numéros, y compris environ 400 parallèles et promos absentes de l'anglais. Le nom japonais vient de la lecture.
- **Pokémon en japonais** : les sets japonais de TCGdex sont utilisés tels quels, sans détour par l'anglais (les exclusivités JP n'y ont pas d'équivalent).

### Cartes que la recherche PSA ne trouve pas : la référence par un slab

Pour une carte déjà gradée au moins une fois, le certificat d'un exemplaire gradé donne la référence exacte de PSA : année, set tel que PSA l'écrit, numéro, nom, variété, spec. Peu importe à qui appartient le slab. Trois façons de l'utiliser :

- **Scanner tes propres slabs** : passe-les sous la caméra comme des cartes nues. Le numéro de certificat est lu sur l'étiquette, importé, puis rattaché à la carte.
- **Le slab de quelqu'un d'autre** : trouve un exemplaire gradé de la carte (annonce eBay, photo). Dans la revue, ouvre **Référence par un slab**, puis saisis le numéro de certificat ou envoie une photo ou une capture d'écran de l'étiquette.
- **certs.txt** : l'import en masse de tes certificats.

La carte passe au vert, et l'outil apprend comment PSA nomme ce set. Les autres cartes du même set passent alors à l'orange avec un libellé déduit.

### Cartes sans aucune pop

Si personne n'a encore gradé la carte, il n'existe pas de référence PSA à recopier. La stratégie :

1. **Le set existe chez PSA** (d'autres cartes du set sont gradées) : la carte est orange. L'outil déduit son libellé des règles du set (format du numéro, langue et casse du nom, vocabulaire de variété). Chez PSA, utilise l'**ajout manuel d'item** avec les champs préparés : ils suivent la façon dont PSA nomme déjà ce set, ce qui maximise les chances d'une étiquette juste.
2. **Le set n'existe pas chez PSA** : la carte est rouge. Fais d'abord une **PSA Research Request** avec la description et les liens pré-rédigés, avant l'envoi.
3. **Au retour de gradation**, colle les numéros de certificat de la commande dans **Retour de gradation**, dans l'ordre de la pile. Chaque carte devient une référence exacte : la prochaine fois, elle sera verte. Une paire qui ne correspond pas (ordre décalé) est signalée au lieu d'être liée.

## Extension Chrome (phase 2)

```bash
npm run ext:build
```

Dans `chrome://extensions`, active le **Mode développeur**, puis **Charger l'extension non empaquetée** et choisis `extension/dist`.

1. L'application locale doit tourner (`npm run dev`).
2. Connecte-toi à psacard.com, démarre une commande et choisis le service toi-même.
3. **Avant la toute première utilisation**, ouvre le popup puis **Inspecter le formulaire** : c'est une lecture seule, l'extension ne touche à rien. Les sélecteurs fournis sont génériques et doivent être ajustés au vrai formulaire PSA. Copie le rapport d'inspection et donne-le à Claude Code (ou ajuste `extension/src/selectors.ts`, ou la surcharge JSON dans **Réglages** du popup, sans recompiler).
4. Lance d'abord en mode **Simulation** : les champs ciblés sont surlignés, rien n'est saisi.
5. Passe ensuite en **Remplissage réel** sur une commande brouillon de 3 cartes.

Pour chaque item, l'extension saisit la recherche, choisit le résultat dont le titre correspond exactement, puis saisit la valeur déclarée. Sans correspondance exacte, elle se met en pause : tu choisis le résultat ou fais l'ajout manuel avec les champs affichés, puis tu cliques **Continuer**. Chaque titre choisi est renvoyé à l'application et devient une correspondance confirmée.

**Garde-fous** : un filtre bloque tout clic sur valider, payer, confirmer, commander ou se connecter, et toute saisie dans un champ mot de passe ou carte bancaire. S'il se déclenche, l'extension s'arrête. À la fin, c'est toi qui relis, valides et paies.

L'extension cassera à chaque refonte du site PSA : la phase 1 (revue + copier-coller) reste utilisable seule.

## Mesurer la qualité (jeu de test)

Prépare `test-cards/` avec tes photos et un fichier `test-cards/truth.csv`. Un modèle est fourni dans [docs/truth.example.csv](docs/truth.example.csv). La colonne `categorie` vaut `recent`, `ancien`, `promo` ou `jamais_gradee`.

```bash
npm run eval
```

La commande écrit `test-cards/eval-report.csv` et indique si le critère M1 est atteint : au moins 90 % d'identités justes sur les cartes récentes, et aucune erreur avec une confiance ≥ 0,9. Grâce au cache, relancer l'évaluation ne refacture pas les images déjà lues.

Pour identifier une seule photo sans caméra :

```bash
npm run identify -- photo.jpg
```

## Coûts

Un appel vision par carte, jamais deux pour la même image grâce au cache. Le coût estimé s'affiche par session et au total. Le modèle (`ANTHROPIC_MODEL`) et l'effort (`ANTHROPIC_EFFORT`) se changent dans `.env`. TCGdex et les données One Piece sont gratuits.

## Sauvegarde

`data/` contient la base de correspondances PSA, l'actif le plus précieux du projet. Ce dossier n'est jamais commité.

```bash
npm run backup
```

La commande copie la base et exporte les correspondances en JSON dans `backups/`. Le bouton **Sauvegarder la base** de la page Correspondances fait la même chose. Pour réimporter un export :

```bash
npm run cli -- mappings:import backups/…/mappings.json
```

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Application locale sur l'ordinateur |
| `npm run phone` | Application en HTTPS + QR code, pour scanner avec le téléphone |
| `npm run catalog:sync` | Synchronise les catalogues (`-- --game pokemon --lang fr,ja --force`) |
| `npm run cli -- catalog:check` | Contrôle du catalogue (M0) |
| `npm run identify -- <photo>` | Identifie une photo, affiche l'identité et la référence PSA en JSON |
| `npm run certs:import [-- fichier]` | Importe des certificats PSA |
| `npm run cli -- psa:unlinked` / `psa:link <id> <card_key>` | Relie les items PSA au catalogue |
| `npm run eval` | Évaluation sur le jeu de test (M1) |
| `npm run backup` | Sauvegarde |
| `npm run ext:build` | Construit l'extension Chrome |
| `npm test` | Tests automatiques |
