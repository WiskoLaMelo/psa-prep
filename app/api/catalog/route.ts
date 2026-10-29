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
    void (async () => {
      try {
        if (!body.game || body.game === "pokemon") onProgress(`Pokémon : ${JSON.stringify(await syncTcgdex(db, { force: body.force, onProgress }))}`);
        if (!body.game || body.game === "onepiece") onProgress(`One Piece : ${JSON.stringify(await syncOnePiece(db, { onProgress }))}`);
        refreshPsa(db);
        onProgress("Terminé.");
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e);
        onProgress(`Erreur : ${state.error}`);
      } finally {
        state.running = false;
      }
    })();
    return json({ started: true });
  });
}
