import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../core/db";
import { config } from "../core/config";
import { syncTcgdex } from "../core/catalog/tcgdex";
import { syncOnePiece } from "../core/catalog/onepiece";
import { catalogStats } from "../core/catalog/store";
import { sha256 } from "../core/identify/image";
import { identifyImage } from "../core/session/pipeline";
import { resolvePsa } from "../core/psa/resolve";
import { importCerts } from "../core/psa/store";
import { refreshPsa } from "../core/session/service";
import { runEval } from "../core/eval";
import { backup, exportMappings, importMappings } from "../core/backup";
import { checkCatalog } from "../core/catalog/check";
import { listUnlinkedPsaItems } from "../core/psa/queries";
import { linkCard } from "../core/psa/store";
import { LANGS, type Lang } from "../core/types";

const [, , cmd, ...rest] = process.argv;
const flags = new Map<string, string | true>();
const args: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]!;
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    flags.set(k!, v ?? (rest[i + 1] && !rest[i + 1]!.startsWith("--") ? rest[++i]! : true));
  } else args.push(a);
}
const flag = (k: string) => (typeof flags.get(k) === "string" ? (flags.get(k) as string) : undefined);
const langsFlag = (): Lang[] | undefined => flag("lang")?.split(",").filter((l): l is Lang => (LANGS as readonly string[]).includes(l));

const HELP = `psa-prep — commandes

  npm run catalog:sync [-- --game pokemon|onepiece] [--lang fr,en,ja] [--force]
      Synchronise les catalogues (TCGdex pour Pokémon, Punk Records pour One Piece).
  npm run cli -- catalog:check
      Vérifie que des cartes connues sont retrouvées par code + numéro dans chaque langue (critère M0).
  npm run identify -- <photo...> [--no-image]
      Identifie une ou plusieurs photos et affiche CardIdentity + référence PSA en JSON (critère M1).
  npm run certs:import [-- certs.txt]
      Importe les numéros de certificat (un par ligne) via l'API PSA.
  npm run cli -- psa:unlinked
      Liste les items PSA importés qui ne sont pas encore reliés au catalogue, avec suggestions.
  npm run cli -- psa:link <psa_item_id> <card_key>
      Relie manuellement un item PSA à une carte du catalogue.
  npm run eval [-- test-cards]
      Évalue l'identification sur test-cards/truth.csv et écrit eval-report.csv.
  npm run backup [-- dossier]
      Sauvegarde la base et exporte les correspondances PSA (par défaut dans backups/).
  npm run cli -- mappings:import <fichier.json>
      Réimporte un export de correspondances.
`;

async function main() {
  const db = getDb();
  switch (cmd) {
    case "catalog:sync": {
      const game = flag("game");
      const opts = { langs: langsFlag(), force: flags.has("force"), onProgress: (m: string) => console.log(m) };
      if (!game || game === "pokemon") console.log("Pokémon :", await syncTcgdex(db, opts));
      if (!game || game === "onepiece") console.log("One Piece :", await syncOnePiece(db, opts));
      console.table(catalogStats(db));
      return;
    }
    case "catalog:check": {
      const res = checkCatalog(db, Number(flag("n") ?? 10));
      for (const r of res) console.log(`${r.ok ? "✓" : "✗"} ${r.game}/${r.lang} ${r.query} → ${r.found ?? "rien"}`);
      const byLang = new Map<string, typeof res>();
      for (const r of res) byLang.set(`${r.game}/${r.lang}`, [...(byLang.get(`${r.game}/${r.lang}`) ?? []), r]);
      for (const [k, v] of byLang) console.log(`${k} : ${v.filter((r) => r.ok).length}/${v.length}`);
      process.exitCode = res.every((r) => r.ok) ? 0 : 1;
      return;
    }
    case "identify": {
      if (!args.length) throw new Error("Usage : npm run identify -- <photo...>");
      if (!config.hasAnthropicKey) throw new Error("ANTHROPIC_API_KEY manquant dans .env");
      for (const file of args) {
        const img = fs.readFileSync(file);
        const res = await identifyImage(db, sha256(img), img, { imageFallback: !flags.has("no-image") });
        const psa = resolvePsa(db, res.identity);
        console.log(JSON.stringify({ file, identity: res.identity, psa, reading: flags.has("raw") ? res.reading : undefined, fromCache: res.fromCache, costUsd: res.costUsd }, null, 2));
      }
      return;
    }
    case "certs:import": {
      const file = args[0] ?? "certs.txt";
      const numbers = fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
      console.log(`${numbers.length} certificats à traiter`);
      const res = await importCerts(db, numbers, {
        token: config.psaToken,
        delayMs: config.psaApiDelayMs,
        onProgress: (r, i, n) => console.log(`[${i + 1}/${n}] ${r.cert} ${r.status}${r.label ? ` — ${r.label}` : ""}${r.cardKey ? ` → ${r.cardKey}` : ""}${r.error ? ` (${r.error})` : ""}`),
      });
      refreshPsa(db);
      const count = (s: string) => res.filter((r) => r.status === s).length;
      console.log(`Liés : ${count("linked") + count("cached")}, à relier : ${count("needs_link")}, introuvables : ${count("not_found")}, erreurs : ${count("error")}`);
      if (count("needs_link")) console.log("→ npm run cli -- psa:unlinked, ou la page Correspondances de l'application.");
      return;
    }
    case "psa:unlinked": {
      for (const u of listUnlinkedPsaItems(db)) {
        console.log(`#${u.item.id} ${u.item.label}`);
        for (const s of u.suggestions) console.log(`    ${s.score.toFixed(2)}  ${s.cardKey}  ${s.name} (${s.setName})`);
      }
      return;
    }
    case "psa:link": {
      const [id, key] = args;
      if (!id || !key) throw new Error("Usage : npm run cli -- psa:link <psa_item_id> <card_key>");
      console.log(linkCard(db, key, Number(id), "user_confirmed"));
      refreshPsa(db);
      return;
    }
    case "eval": {
      const dir = args[0] ?? "test-cards";
      const { summary, report } = await runEval(db, dir, { imageFallback: !flags.has("no-image") }, (r, i, n) =>
        console.log(`[${i + 1}/${n}] ${r.correct ? "✓" : "✗"} ${r.confidence.toFixed(2)} ${r.file}${r.correct ? "" : ` — ${r.reason}`}`),
      );
      console.log(summary);
      console.log(`Rapport : ${report}`);
      console.log(summary.m1Passed ? "Critère M1 atteint." : "Critère M1 non atteint.");
      return;
    }
    case "backup": {
      console.log(`Sauvegarde : ${await backup(db, args[0] ?? "backups")}`);
      return;
    }
    case "mappings:export": {
      const out = args[0] ?? "mappings.json";
      fs.writeFileSync(out, JSON.stringify(exportMappings(db), null, 2));
      console.log(`Écrit : ${path.resolve(out)}`);
      return;
    }
    case "mappings:import": {
      if (!args[0]) throw new Error("Usage : npm run cli -- mappings:import <fichier.json>");
      importMappings(db, JSON.parse(fs.readFileSync(args[0], "utf8")));
      refreshPsa(db);
      console.log("Correspondances importées.");
      return;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
