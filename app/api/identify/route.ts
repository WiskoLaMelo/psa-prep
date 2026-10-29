import { config } from "@/core/config";
import { sha256 } from "@/core/identify/image";
import { identifyImage } from "@/core/session/pipeline";
import { resolvePsa } from "@/core/psa/resolve";
import { error, getDb, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Test rapide : identifie une photo envoyée, sans créer de session. */
export async function POST(req: Request) {
  return handle(async () => {
    if (!config.hasAnthropicKey && !process.env.VISION_MOCK_FILE) return error("Ajoute d'abord ta clé Anthropic (étape 1).");
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof Blob)) return error("Choisis une photo");
    const buf = Buffer.from(await file.arrayBuffer());
    const db = getDb();
    const res = await identifyImage(db, sha256(buf), buf);
    return json({ identity: res.identity, psa: resolvePsa(db, res.identity), reading: res.reading, fromCache: res.fromCache, costUsd: res.costUsd });
  });
}
