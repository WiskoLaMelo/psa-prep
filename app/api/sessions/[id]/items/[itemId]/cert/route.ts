import { eq } from "drizzle-orm";
import { sessionItems } from "@/core/db/schema";
import { config } from "@/core/config";
import { sha256 } from "@/core/identify/image";
import { readWithCache } from "@/core/session/pipeline";
import { attachCert, subjectMatches } from "@/core/psa/store";
import { refreshPsa } from "@/core/session/service";
import type { CardIdentity } from "@/core/types";
import { error, getDb, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; itemId: string }> };

/**
 * Référence par un slab : numéro de certificat (JSON { cert }) ou photo / capture d'écran d'un slab
 * (multipart, champ "image", y compris d'une annonce). Le certificat est rattaché à cette carte.
 */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { itemId } = await params;
    const db = getDb();
    const item = db.select().from(sessionItems).where(eq(sessionItems.id, Number(itemId))).get();
    if (!item?.identityJson) return error("Identifie d'abord la carte (ou corrige son identité)");
    const identity = JSON.parse(item.identityJson) as CardIdentity;
    if (!config.psaToken) return error("PSA_API_TOKEN manquant dans .env");

    let cert = "";
    let force = false;
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("image");
      if (!(file instanceof Blob)) return error("Image manquante");
      const buf = Buffer.from(await file.arrayBuffer());
      const { reading } = await readWithCache(db, sha256(buf), buf, {});
      cert = reading.slab_cert_number?.replace(/\D/g, "") ?? "";
      if (!cert) return error("Aucun numéro de certificat lisible sur cette image : saisis-le à la main");
    } else {
      const body = (await req.json()) as { cert?: string; force?: boolean };
      cert = body.cert?.replace(/\D/g, "") ?? "";
      force = Boolean(body.force);
    }
    if (!cert) return error("Numéro de certificat manquant");

    const { cert: data } = await attachCert(db, cert, identity.cardKey, { token: config.psaToken });
    const sim = subjectMatches(data.Subject ?? "", identity, data.CardNumber);
    refreshPsa(db);
    return json({
      ok: true,
      cert,
      label: [data.Year, data.Brand, data.CardNumber ? `#${data.CardNumber}` : "", data.Subject, data.Variety].filter(Boolean).join(" "),
      warning: sim < 0.6 && !force ? `Attention : le sujet du certificat (${data.Subject}) ne ressemble pas à ${identity.nameEn ?? identity.name}. Vérifie que c'est bien la même carte.` : null,
    });
  });
}
