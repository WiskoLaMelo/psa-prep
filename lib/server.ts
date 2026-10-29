import "server-only";
import { getDb } from "@/core/db";
import { IdentifyQueue } from "@/core/session/queue";

const g = globalThis as unknown as { __psaQueue?: IdentifyQueue };

/** File d'identification partagée par toutes les routes ; reprend les captures en attente au démarrage. */
export function getQueue(): IdentifyQueue {
  if (!g.__psaQueue) {
    g.__psaQueue = new IdentifyQueue(getDb());
    g.__psaQueue.resume();
    g.__psaQueue.startPolling();
  }
  return g.__psaQueue;
}

export { getDb };

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** Exécute un handler et transforme les exceptions en réponse JSON lisible. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    return error(e instanceof Error ? e.message : String(e), 500);
  }
}

/** En-têtes CORS pour l'extension Chrome (origine chrome-extension://). Le serveur n'écoute qu'en local. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = origin.startsWith("chrome-extension://") || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return allowed
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
    : {};
}
