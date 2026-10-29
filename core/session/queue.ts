import type { Db } from "../db";
import { pendingCaptureIds, processCapture, type PipelineDeps } from "./pipeline";

/**
 * File d'identification en arrière-plan, dans le processus du serveur local.
 * L'état vit en base (captures.status) : au redémarrage, les captures en attente sont reprises.
 * Les erreurs réseau sont retentées avec un délai croissant ; la capture n'est jamais bloquée.
 */
export class IdentifyQueue {
  private queue: number[] = [];
  private inFlight = new Set<number>();
  private retries = new Map<number, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private db: Db,
    private deps: PipelineDeps = {},
    private concurrency = 3,
    private maxRetries = 4,
  ) {}

  /** Reprend tout ce qui n'a pas été traité (après redémarrage ou coupure réseau). */
  resume(sessionId?: string) {
    for (const id of pendingCaptureIds(this.db, sessionId)) this.push(id);
  }

  push(captureId: number) {
    if (this.inFlight.has(captureId) || this.queue.includes(captureId)) return;
    this.queue.push(captureId);
    this.pump();
  }

  get size() {
    return this.queue.length + this.inFlight.size;
  }

  private pump() {
    while (this.inFlight.size < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      this.inFlight.add(id);
      processCapture(this.db, id, this.deps)
        .then(() => this.retries.delete(id))
        .catch((e: unknown) => {
          const n = (this.retries.get(id) ?? 0) + 1;
          this.retries.set(id, n);
          const transient = !(e instanceof Error && /Session introuvable|ENOENT|illisible|refusée/.test(e.message));
          if (transient && n <= this.maxRetries) {
            setTimeout(() => this.push(id), Math.min(60_000, 2000 * 2 ** n)).unref?.();
          }
        })
        .finally(() => {
          this.inFlight.delete(id);
          this.pump();
        });
    }
  }

  /** Relance périodique des captures en attente (utile si le réseau revient). */
  startPolling(intervalMs = 30_000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.resume(), intervalMs);
    this.timer.unref?.();
  }
}
