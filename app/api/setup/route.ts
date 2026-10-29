import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/core/config";
import { catalogStats } from "@/core/catalog/store";
import { updateEnvFile } from "@/core/env-file";
import { error, getDb, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Les réglages ne se modifient que depuis l'ordinateur lui-même, jamais depuis un autre appareil du réseau. */
function isLocal(req: Request) {
  const host = (req.headers.get("host") ?? "").split(":")[0];
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export async function GET() {
  return handle(() => {
    const stats = catalogStats(getDb());
    const count = (game: string) => stats.filter((s) => s.game === game).reduce((n, s) => n + s.cards, 0);
    return json({
      hasAnthropicKey: config.hasAnthropicKey,
      hasPsaToken: Boolean(config.psaToken),
      pokemonCards: count("pokemon"),
      onePieceCards: count("onepiece"),
      stats,
      nodeVersion: process.versions.node,
    });
  });
}

/** Enregistre la clé Anthropic et/ou le token PSA dans .env, après avoir vérifié que la clé fonctionne. */
export async function POST(req: Request) {
  return handle(async () => {
    if (!isLocal(req)) return error("Les réglages se font depuis l'ordinateur (http://localhost:3000/setup), pas depuis le téléphone.", 403);
    const body = (await req.json()) as { anthropicKey?: string; psaToken?: string };
    const updates: Record<string, string> = {};
    if (body.anthropicKey?.trim()) {
      const key = body.anthropicKey.trim();
      if (!key.startsWith("sk-ant-")) return error("Cette clé ne ressemble pas à une clé Anthropic : elle doit commencer par « sk-ant- ».");
      try {
        await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) return error("Clé refusée par Anthropic : vérifie que tu l'as copiée en entier.");
        if (e instanceof Anthropic.PermissionDeniedError) return error("Clé valide mais sans accès à l'API : vérifie ton compte sur console.anthropic.com.");
        if (!(e instanceof Anthropic.APIConnectionError)) throw e;
        return error("Impossible de joindre Anthropic : vérifie la connexion Internet de l'ordinateur.");
      }
      updates.ANTHROPIC_API_KEY = key;
    }
    if (body.psaToken?.trim()) updates.PSA_API_TOKEN = body.psaToken.trim();
    if (!Object.keys(updates).length) return error("Rien à enregistrer");
    updateEnvFile(updates);
    return json({ ok: true, saved: Object.keys(updates) });
  });
}
