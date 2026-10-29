import { deleteSession, getSession, listItems, sessionCost, updateSession } from "@/core/session/service";
import { pendingCaptureIds } from "@/core/session/pipeline";
import { error, getDb, getQueue, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const db = getDb();
    const session = getSession(db, id);
    if (!session) return error("Session introuvable", 404);
    getQueue();
    return json({ session, items: listItems(db, id), cost: sessionCost(db, id), pending: pendingCaptureIds(db, id).length });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = (await req.json()) as { name?: string; status?: string; notes?: string };
    return json(updateSession(getDb(), id, body));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    deleteSession(getDb(), id);
    return json({ ok: true });
  });
}
