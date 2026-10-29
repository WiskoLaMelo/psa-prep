import { listPsaItemsForSet, listPsaSets, listUnlinkedPsaItems } from "@/core/psa/queries";
import { linkCard, unlinkCard } from "@/core/psa/store";
import { refreshPsa } from "@/core/session/service";
import { error, getDb, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(() => {
    const db = getDb();
    const setId = new URL(req.url).searchParams.get("set");
    if (setId) return json({ items: listPsaItemsForSet(db, Number(setId)) });
    return json({ sets: listPsaSets(db), unlinked: listUnlinkedPsaItems(db) });
  });
}

/** Relie (ou délie) une carte du catalogue et un item PSA. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json()) as { psaItemId?: number; cardKey?: string; unlink?: boolean };
    const db = getDb();
    if (!body.cardKey) return error("card_key manquante");
    if (body.unlink) unlinkCard(db, body.cardKey);
    else {
      if (!body.psaItemId) return error("psaItemId manquant");
      if (body.cardKey.split(":").length < 5) return error("card_key invalide (jeu:langue:set:numéro:variante)");
      linkCard(db, body.cardKey, body.psaItemId, "user_confirmed");
    }
    refreshPsa(db);
    return json({ ok: true });
  });
}
