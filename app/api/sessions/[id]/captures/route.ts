import { addCapture, undoLastCapture } from "@/core/session/service";
import { error, getDb, getQueue, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Reçoit une photo (multipart, champ "image") et lance l'identification en arrière-plan. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof Blob)) return error("Champ image manquant");
    const side = form.get("side") === "back" ? "back" : "front";
    const { capture, item } = await addCapture(getDb(), id, Buffer.from(await file.arrayBuffer()), side);
    if (side === "front") getQueue().push(capture.id);
    return json({ captureId: capture.id, itemId: item.id, position: item.position, side }, { status: 201 });
  });
}

/** Annule la dernière capture. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return json({ undone: undoLastCapture(getDb(), id) });
  });
}
