import { eq } from "drizzle-orm";
import { sessionItems } from "@/core/db/schema";
import { confirmFound } from "@/core/psa/store";
import { refreshPsa } from "@/core/session/service";
import type { CardIdentity } from "@/core/types";
import { corsHeaders, getDb, handle } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** L'extension renvoie chaque titre PSA sélectionné : il devient une correspondance confirmée. */
export async function POST(req: Request) {
  return handle(async () => {
    const headers = corsHeaders(req);
    const body = (await req.json()) as { itemId?: number; title?: string; specId?: string; searchString?: string };
    const db = getDb();
    const item = body.itemId ? db.select().from(sessionItems).where(eq(sessionItems.id, body.itemId)).get() : undefined;
    if (!item?.identityJson || !body.title) return Response.json({ error: "Item ou titre manquant" }, { status: 400, headers });
    const identity = JSON.parse(item.identityJson) as CardIdentity;
    confirmFound(db, identity, { title: body.title, specId: body.specId ?? null, source: "user_confirmed" });
    refreshPsa(db);
    return Response.json({ ok: true }, { headers });
  });
}
