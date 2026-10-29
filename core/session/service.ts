import { and, asc, eq, gt, gte, lt, lte, sql } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "../db";
import { captures, identifications, sessionItems, sessions, visionCache } from "../db/schema";
import type { CardCandidate, CardIdentity, ManualFields, PsaResolution } from "../types";
import { config } from "../config";
import { sha256 } from "../identify/image";
import { resolvePsa } from "../psa/resolve";
import { identityFromCandidate } from "../identify/resolve";
import { makeCardKey } from "../cards/key";

export type SessionRow = typeof sessions.$inferSelect;
export type SessionItemRow = typeof sessionItems.$inferSelect;
export type CaptureRow = typeof captures.$inferSelect;

export interface SessionItemView {
  id: number;
  position: number;
  frontCaptureId: number | null;
  backCaptureId: number | null;
  frontImageHash: string | null;
  backImageHash: string | null;
  captureStatus: string | null;
  captureError: string | null;
  identity: CardIdentity | null;
  psa: PsaResolution | null;
  manualOverrides: Partial<ManualFields> | null;
  declaredValue: number | null;
  notes: string | null;
  duplicateOf: number[];
}

const parse = <T>(s: string | null | undefined): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

export function createSession(db: Db, name?: string): SessionRow {
  const id = crypto.randomUUID().slice(0, 8);
  const label = name?.trim() || `Submission du ${new Date().toLocaleDateString("fr-FR")}`;
  return db.insert(sessions).values({ id, name: label }).returning().get();
}

export function listSessions(db: Db) {
  return db.all<SessionRow & { items: number; green: number; orange: number; red: number; pending: number }>(sql`
    select s.*,
      (select count(*) from session_items i where i.session_id = s.id) as items,
      (select count(*) from session_items i where i.session_id = s.id and i.psa_status = 'green') as green,
      (select count(*) from session_items i where i.session_id = s.id and i.psa_status = 'orange') as orange,
      (select count(*) from session_items i where i.session_id = s.id and i.psa_status = 'red') as red,
      (select count(*) from captures c where c.session_id = s.id and c.status in ('pending','processing')) as pending
    from sessions s order by s.created_at desc`);
}

export function getSession(db: Db, id: string) {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

export function updateSession(db: Db, id: string, patch: Partial<Pick<SessionRow, "name" | "status" | "notes">>) {
  return db.update(sessions).set(patch).where(eq(sessions.id, id)).returning().get();
}

export function deleteSession(db: Db, id: string) {
  db.delete(sessions).where(eq(sessions.id, id)).run();
}

export function imagePath(hash: string) {
  return path.join(config.imagesDir, hash.slice(0, 2), `${hash}.jpg`);
}

/** Enregistre une photo (nommée par son hash) et l'ajoute à la pile : recto = nouvel item, verso = item précédent. */
export async function addCapture(db: Db, sessionId: string, image: Buffer, side: "front" | "back" = "front"): Promise<{ capture: CaptureRow; item: SessionItemRow }> {
  if (!getSession(db, sessionId)) throw new Error("Session introuvable");
  const hash = sha256(image);
  const file = imagePath(hash);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, image);
  return db.transaction((tx) => {
    let item: SessionItemRow | undefined;
    if (side === "back") {
      item = tx
        .select()
        .from(sessionItems)
        .where(and(eq(sessionItems.sessionId, sessionId), sql`${sessionItems.backCaptureId} is null`))
        .orderBy(sql`${sessionItems.position} desc`)
        .get();
    }
    if (!item) {
      const max = tx.get<{ m: number | null }>(sql`select max(position) as m from session_items where session_id = ${sessionId}`);
      item = tx
        .insert(sessionItems)
        .values({ sessionId, position: (max?.m ?? 0) + 1 })
        .returning()
        .get();
    }
    const capture = tx
      .insert(captures)
      .values({ sessionId, sessionItemId: item.id, side, imagePath: path.relative(config.dataDir, file), imageHash: hash, status: side === "front" ? "pending" : "done" })
      .returning()
      .get();
    item = tx
      .update(sessionItems)
      .set(side === "front" ? { frontCaptureId: capture.id } : { backCaptureId: capture.id })
      .where(eq(sessionItems.id, item.id))
      .returning()
      .get();
    return { capture, item };
  });
}

/** Annule la dernière capture de la session (bouton « annuler la dernière »). */
export function undoLastCapture(db: Db, sessionId: string): boolean {
  const last = db.select().from(captures).where(eq(captures.sessionId, sessionId)).orderBy(sql`${captures.id} desc`).get();
  if (!last) return false;
  const item = last.sessionItemId ? db.select().from(sessionItems).where(eq(sessionItems.id, last.sessionItemId)).get() : undefined;
  db.transaction((tx) => {
    tx.delete(captures).where(eq(captures.id, last.id)).run();
    if (item) {
      if (last.side === "back") tx.update(sessionItems).set({ backCaptureId: null }).where(eq(sessionItems.id, item.id)).run();
      else removeItemTx(tx as unknown as Db, item);
    }
  });
  return true;
}

function removeItemTx(tx: Db, item: SessionItemRow) {
  tx.delete(captures).where(eq(captures.sessionItemId, item.id)).run();
  tx.delete(sessionItems).where(eq(sessionItems.id, item.id)).run();
  tx.update(sessionItems)
    .set({ position: sql`${sessionItems.position} - 1` })
    .where(and(eq(sessionItems.sessionId, item.sessionId), gt(sessionItems.position, item.position)))
    .run();
}

export function deleteItem(db: Db, itemId: number) {
  const item = db.select().from(sessionItems).where(eq(sessionItems.id, itemId)).get();
  if (!item) return;
  db.transaction((tx) => removeItemTx(tx as unknown as Db, item));
}

/** Déplace un item à une nouvelle position (1 = dessus de la pile). */
export function moveItem(db: Db, itemId: number, newPosition: number) {
  const item = db.select().from(sessionItems).where(eq(sessionItems.id, itemId)).get();
  if (!item) return;
  const count = db.get<{ n: number }>(sql`select count(*) as n from session_items where session_id = ${item.sessionId}`)?.n ?? 1;
  const target = Math.max(1, Math.min(count, Math.round(newPosition)));
  if (target === item.position) return;
  db.transaction((tx) => {
    if (target < item.position) {
      tx.update(sessionItems)
        .set({ position: sql`${sessionItems.position} + 1` })
        .where(and(eq(sessionItems.sessionId, item.sessionId), gte(sessionItems.position, target), lt(sessionItems.position, item.position)))
        .run();
    } else {
      tx.update(sessionItems)
        .set({ position: sql`${sessionItems.position} - 1` })
        .where(and(eq(sessionItems.sessionId, item.sessionId), gt(sessionItems.position, item.position), lte(sessionItems.position, target)))
        .run();
    }
    tx.update(sessionItems).set({ position: target }).where(eq(sessionItems.id, itemId)).run();
  });
}

/** Enregistre l'identité d'un item et recalcule sa référence PSA. */
export function setItemIdentity(db: Db, itemId: number, identity: CardIdentity | null) {
  const item = db.select().from(sessionItems).where(eq(sessionItems.id, itemId)).get();
  if (!item) return;
  const overrides = parse<Partial<ManualFields>>(item.manualOverridesJson);
  const psa = identity ? resolvePsa(db, identity, overrides) : null;
  db.update(sessionItems)
    .set({
      cardKey: identity?.cardKey ?? null,
      identityJson: identity ? JSON.stringify(identity) : null,
      psaStatus: psa?.status ?? null,
      psaJson: psa ? JSON.stringify(psa) : null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sessionItems.id, itemId))
    .run();
}

/** Recalcule la référence PSA de tous les items (après un import de certificats ou une confirmation). */
export function refreshPsa(db: Db, sessionId?: string) {
  const items = db
    .select()
    .from(sessionItems)
    .where(sessionId ? eq(sessionItems.sessionId, sessionId) : sql`1=1`)
    .all();
  for (const it of items) {
    const identity = parse<CardIdentity>(it.identityJson);
    if (identity) setItemIdentity(db, it.id, identity);
  }
}

export interface ItemPatch {
  candidateCardKey?: string;
  identity?: Partial<Pick<CardIdentity, "setId" | "setName" | "number" | "name" | "nameEn" | "variant" | "lang" | "game">>;
  manualOverrides?: Partial<ManualFields> | null;
  declaredValue?: number | null;
  notes?: string | null;
  position?: number;
}

/** Correction d'un item depuis l'écran de revue. */
export function patchItem(db: Db, itemId: number, patch: ItemPatch) {
  const item = db.select().from(sessionItems).where(eq(sessionItems.id, itemId)).get();
  if (!item) throw new Error("Item introuvable");
  if (patch.position !== undefined) moveItem(db, itemId, patch.position);
  const simple: Partial<SessionItemRow> = {};
  if (patch.declaredValue !== undefined) simple.declaredValue = patch.declaredValue;
  if (patch.notes !== undefined) simple.notes = patch.notes;
  if (patch.manualOverrides !== undefined) simple.manualOverridesJson = patch.manualOverrides ? JSON.stringify(patch.manualOverrides) : null;
  if (Object.keys(simple).length) db.update(sessionItems).set(simple).where(eq(sessionItems.id, itemId)).run();

  let identity = parse<CardIdentity>(item.identityJson);
  if (patch.candidateCardKey && identity) {
    const cand = identity.candidates.find((c: CardCandidate) => c.cardKey === patch.candidateCardKey);
    if (cand) identity = { ...identityFromCandidate(db, identity, cand), candidates: identity.candidates };
  }
  if (patch.identity) {
    const base: CardIdentity = identity ?? {
      game: "pokemon",
      lang: "en",
      setId: "",
      setName: "",
      number: "",
      name: "",
      nameEn: null,
      variant: "base",
      cardKey: "",
      catalogKey: null,
      releaseYear: null,
      imageUrl: null,
      confidence: 0,
      method: "manual",
      candidates: [],
      warnings: [],
    };
    const next = { ...base, ...patch.identity };
    next.cardKey = makeCardKey({ game: next.game, lang: next.lang, setId: next.setId || "unknown", number: next.number || "unknown", variant: next.variant });
    next.method = "manual";
    next.confidence = 1;
    next.warnings = [];
    identity = next;
  }
  if (patch.candidateCardKey || patch.identity) {
    db.update(identifications).set({ userCorrected: true }).where(eq(identifications.captureId, item.frontCaptureId ?? -1)).run();
  }
  setItemIdentity(db, itemId, identity);
}

export function listItems(db: Db, sessionId: string): SessionItemView[] {
  const rows = db
    .select({ item: sessionItems, front: captures })
    .from(sessionItems)
    .leftJoin(captures, eq(captures.id, sessionItems.frontCaptureId))
    .where(eq(sessionItems.sessionId, sessionId))
    .orderBy(asc(sessionItems.position))
    .all();
  const backs = new Map(
    db
      .select({ id: captures.id, hash: captures.imageHash })
      .from(captures)
      .where(and(eq(captures.sessionId, sessionId), eq(captures.side, "back")))
      .all()
      .map((c) => [c.id, c.hash]),
  );
  const byKey = new Map<string, number[]>();
  for (const r of rows) if (r.item.cardKey) byKey.set(r.item.cardKey, [...(byKey.get(r.item.cardKey) ?? []), r.item.position]);
  return rows.map(({ item, front }) => ({
    id: item.id,
    position: item.position,
    frontCaptureId: item.frontCaptureId,
    backCaptureId: item.backCaptureId,
    frontImageHash: front?.imageHash ?? null,
    backImageHash: item.backCaptureId ? (backs.get(item.backCaptureId) ?? null) : null,
    captureStatus: front?.status ?? null,
    captureError: front?.error ?? null,
    identity: parse<CardIdentity>(item.identityJson),
    psa: parse<PsaResolution>(item.psaJson),
    manualOverrides: parse<Partial<ManualFields>>(item.manualOverridesJson),
    declaredValue: item.declaredValue,
    notes: item.notes,
    duplicateOf: item.cardKey ? (byKey.get(item.cardKey) ?? []).filter((p) => p !== item.position) : [],
  }));
}

/** Nombre d'appels vision facturés et coût estimé pour une session. */
export function sessionCost(db: Db, sessionId: string) {
  return (
    db.get<{ calls: number; cost: number }>(sql`
      select coalesce(sum(i.vision_calls), 0) as calls, coalesce(sum(i.cost_usd), 0) as cost
      from identifications i join captures c on c.id = i.capture_id where c.session_id = ${sessionId}`) ?? { calls: 0, cost: 0 }
  );
}

export function totalVisionCost(db: Db) {
  return db.get<{ calls: number; cost: number }>(sql`select count(*) as calls, coalesce(sum(cost_usd), 0) as cost from ${visionCache}`) ?? { calls: 0, cost: 0 };
}
