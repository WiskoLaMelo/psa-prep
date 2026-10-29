import { eq, and } from "drizzle-orm";
import { captures } from "@/core/db/schema";
import { resetErrored } from "@/core/session/pipeline";
import { getDb, getQueue, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Relance les identifications en erreur, ou une capture précise (corps { captureId }). */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const db = getDb();
    const body = (await req.json().catch(() => ({}))) as { captureId?: number };
    let ids: number[];
    if (body.captureId) {
      db.update(captures).set({ status: "pending", error: null }).where(and(eq(captures.id, body.captureId), eq(captures.sessionId, id))).run();
      ids = [body.captureId];
    } else ids = resetErrored(db, id);
    for (const c of ids) getQueue().push(c);
    return json({ requeued: ids.length });
  });
}
