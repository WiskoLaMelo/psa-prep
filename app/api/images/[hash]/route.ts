import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/core/config";
import { imagePath } from "@/core/session/service";
import { thumbnail } from "@/core/identify/image";
import { error, handle } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ hash: string }> };

/** Sert une photo capturée ; ?w=240 renvoie une miniature (mise en cache sur disque). */
export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { hash } = await params;
    if (!/^[0-9a-f]{64}$/.test(hash)) return error("Hash invalide", 400);
    const w = Number(new URL(req.url).searchParams.get("w") ?? 0);
    const headers = { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" };
    if (!w) return new Response(new Uint8Array(await fs.readFile(imagePath(hash))), { headers });
    const width = Math.min(1200, Math.max(60, Math.round(w)));
    const thumbFile = path.join(config.cacheDir, "thumbs", `${hash}-${width}.jpg`);
    try {
      return new Response(new Uint8Array(await fs.readFile(thumbFile)), { headers });
    } catch {
      const buf = await thumbnail(await fs.readFile(imagePath(hash)), width);
      await fs.mkdir(path.dirname(thumbFile), { recursive: true });
      await fs.writeFile(thumbFile, buf);
      return new Response(new Uint8Array(buf), { headers });
    }
  });
}
