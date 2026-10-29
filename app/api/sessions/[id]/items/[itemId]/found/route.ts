import { eq } from "drizzle-orm";
import { sessionItems } from "@/core/db/schema";
import { confirmFound } from "@/core/psa/store";
import { refreshPsa } from "@/core/session/service";
import type { CardIdentity } from "@/core/types";
import { error, getDb, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; itemId: string }> };

/** « Trouvé chez PSA » : le titre exact devient une correspondance confirmée. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, itemId } = await params;
    const body = (await req.json()) as { title?: string; specId?: string; searchPattern?: string };
    if (!body.title?.trim()) return error("Colle le titre exact affiché par PSA");
    const db = getDb();
    const item = db.select().from(sessionItems).where(eq(sessionItems.id, Number(itemId))).get();
    if (!item?.identityJson) return error("Carte non identifiée : corrige d'abord son identité");
    const identity = JSON.parse(item.identityJson) as CardIdentity;
    const res = confirmFound(db, identity, { title: body.title, specId: body.specId || null, searchPattern: body.searchPattern || null });
    // La confirmation profite aussitôt aux autres cartes du même set, dans toutes les sessions.
    refreshPsa(db);
    return json({ ok: true, itemId: res.item.id, sessionId: id });
  });
}
