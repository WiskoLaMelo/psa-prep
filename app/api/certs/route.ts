import { config } from "@/core/config";
import { importCerts } from "@/core/psa/store";
import { refreshPsa } from "@/core/session/service";
import { error, getDb, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** Importe des numéros de certificat collés (un par ligne, ou séparés par espaces/virgules). */
export async function POST(req: Request) {
  return handle(async () => {
    const { text } = (await req.json()) as { text?: string };
    const numbers = (text ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter((s) => /^\d{6,}$/.test(s));
    if (!numbers.length) return error("Aucun numéro de certificat trouvé");
    if (!config.psaToken) return error("PSA_API_TOKEN manquant dans .env");
    const db = getDb();
    const results = await importCerts(db, numbers, { token: config.psaToken, delayMs: config.psaApiDelayMs });
    refreshPsa(db);
    return json({ results });
  });
}
