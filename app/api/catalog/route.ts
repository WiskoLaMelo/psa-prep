import { catalogStats } from "@/core/catalog/store";
import { syncTcgdex } from "@/core/catalog/tcgdex";
import { syncOnePiece } from "@/core/catalog/onepiece";
import { checkCatalog } from "@/core/catalog/check";
import { refreshPsa } from "@/core/session/service";
import { getDb, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __catalogSync?: { running: boolean; log: string[]; startedAt: string; error?: string } };

export async function GET(req: Request) {
  return handle(() => {
    const db = getDb();
    if (new URL(req.url).searchParams.get("check")) return json({ check: checkCatalog(db, 10) });
    return json({ stats: catalogStats(db), sync: g.__catalogSync ?? null });
  });
}

/** Lance une synchronisation en arrière-plan ; l'avancement se lit via GET. */
export async function POST(req: Request) {
  return handle(async () => {
    if (g.__catalogSync?.running) return json({ started: false, sync: g.__catalogSync });
    const body = (await req.json().catch(() => ({}))) as { game?: "pokemon" | "onepiece"; force?: boolean };
    const state = { running: true, log: [] as string[], startedAt: new Date().toISOString(), error: undefined as string | undefined };
    g.__catalogSync = state;
    const db = getDb();
    const onProgress = (m: string) => state.log.push(m);
    // Chaque jeu est synchronisé indépendamment : une source injoignable n'empêche pas l'autre.
    const run = async (label: string, host: string, fn: () => Promise<unknown>) => {
      try {
        const summary = (await fn()) as Record<string, { cards: number }>;
        onProgress(`✓ ${label} : ${Object.entries(summary).map(([lang, s]) => `${lang.toUpperCase()} ${s.cards} cartes mises à jour`).join(", ")}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const network = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|network/i.test(msg);
        state.error = msg;
        onProgress(`✗ ${label} : ${network ? `impossible de joindre ${host} (connexion Internet, pare-feu ou site en panne). Réessaie dans quelques minutes.` : msg}`);
      }
    };
    void (async () => {
      try {
        if (!body.game || body.game === "pokemon") await run("Pokémon", "api.tcgdex.net", () => syncTcgdex(db, { force: body.force, onProgress }));
        if (!body.game || body.game === "onepiece") await run("One Piece", "raw.githubusercontent.com", () => syncOnePiece(db, { onProgress }));
        refreshPsa(db);
        onProgress(state.error ? "Terminé, avec des erreurs (voir ci-dessus)." : "Terminé.");
      } finally {
        state.running = false;
      }
    })();
    return json({ started: true });
  });
}
