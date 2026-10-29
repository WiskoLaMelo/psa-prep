import { deleteItem, patchItem, type ItemPatch } from "@/core/session/service";
import { getDb, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { itemId } = await params;
    patchItem(getDb(), Number(itemId), (await req.json()) as ItemPatch);
    return json({ ok: true });
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { itemId } = await params;
    deleteItem(getDb(), Number(itemId));
    return json({ ok: true });
  });
}
