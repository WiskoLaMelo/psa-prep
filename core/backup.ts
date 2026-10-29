import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db";
import { mappings, psaItems, psaSetLinks, psaSets, certs } from "./db/schema";

/** Export lisible de la base de correspondances PSA, l'actif le plus précieux du projet. */
export function exportMappings(db: Db) {
  return {
    format: "psa-prep-mappings",
    version: 1,
    exportedAt: new Date().toISOString(),
    psaSets: db.select().from(psaSets).all(),
    psaSetLinks: db.select().from(psaSetLinks).all(),
    psaItems: db.select().from(psaItems).all(),
    mappings: db.select().from(mappings).all(),
    certs: db.select().from(certs).all(),
  };
}

/** Copie cohérente de la base SQLite + export JSON des correspondances, dans un dossier horodaté. */
export async function backup(db: Db, dir: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = path.resolve(dir, `psa-prep-${stamp}`);
  fs.mkdirSync(target, { recursive: true });
  await db.$client.backup(path.join(target, "psa-prep.sqlite"));
  fs.writeFileSync(path.join(target, "mappings.json"), JSON.stringify(exportMappings(db), null, 2));
  return target;
}

/** Réimporte un export de correspondances (fusion : les lignes existantes sont conservées). */
export function importMappings(db: Db, data: ReturnType<typeof exportMappings>) {
  if (data.format !== "psa-prep-mappings") throw new Error("Fichier de correspondances invalide");
  db.transaction((tx) => {
    for (const r of data.psaSets) tx.insert(psaSets).values(r).onConflictDoNothing().run();
    for (const r of data.psaItems) tx.insert(psaItems).values(r).onConflictDoNothing().run();
    for (const r of data.psaSetLinks) tx.insert(psaSetLinks).values(r).onConflictDoNothing().run();
    for (const r of data.mappings) tx.insert(mappings).values(r).onConflictDoNothing().run();
    for (const r of data.certs) tx.insert(certs).values(r).onConflictDoNothing().run();
  });
}
