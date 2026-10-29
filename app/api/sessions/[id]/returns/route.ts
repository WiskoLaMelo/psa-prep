import { config } from "@/core/config";
import { attachReturnedCerts } from "@/core/psa/store";
import { listItems, refreshPsa } from "@/core/session/service";
import { error, getDb, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
type Ctx = { params: Promise<{ id: string }> };

/** Retour de gradation : certificats reçus dans l'ordre de la commande, rattachés carte par carte. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const { text, startAt } = (await req.json()) as { text?: string; startAt?: number };
    const numbers = (text ?? "").split(/[\s,;]+/).filter((s) => /^\d{6,}$/.test(s));
    if (!numbers.length) return error("Aucun numéro de certificat trouvé");
    if (!config.psaToken) return error("PSA_API_TOKEN manquant dans .env");
    const db = getDb();
    const items = listItems(db, id).filter((i) => i.position >= (startAt ?? 1));
    const results = await attachReturnedCerts(db, items, numbers, { token: config.psaToken, delayMs: config.psaApiDelayMs });
    refreshPsa(db);
    return json({ results });
  });
}
