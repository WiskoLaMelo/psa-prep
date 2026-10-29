import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "../db";
import { captures, catalogCards, identifications, visionCache } from "../db/schema";
import { config } from "../config";
import { prepareForVision } from "../identify/image";
import { IMAGE_MATCH_STRONG, rerankByImage } from "../identify/image-match";
import { resolveIdentity } from "../identify/resolve";
import { VisionReadingSchema, type VisionReading } from "../identify/reading";
import { readCardWithClaude, type VisionReader } from "../identify/vision";
import type { CardIdentity } from "../types";
import type { FetchLike } from "../util/http";
import { setItemIdentity } from "./service";
import { attachCert, subjectMatches, unlinkCard } from "../psa/store";

export interface PipelineDeps {
  vision?: VisionReader;
  fetch?: FetchLike;
  /** Désactive le secours par image (tests, mode hors ligne). */
  imageFallback?: boolean;
  /** Token PSA (par défaut celui de .env ; null pour désactiver). */
  psaToken?: string | null;
}

export interface IdentifyResult {
  reading: VisionReading;
  identity: CardIdentity;
  fromCache: boolean;
  costUsd: number;
}

/** Lecture vision avec cache par hash d'image : une image déjà lue n'est jamais renvoyée à l'API. */
export async function readWithCache(db: Db, imageHash: string, original: Buffer, deps: PipelineDeps) {
  const cached = db.select().from(visionCache).where(eq(visionCache.imageHash, imageHash)).get();
  if (cached) {
    const parsed = VisionReadingSchema.safeParse(JSON.parse(cached.rawJson));
    if (parsed.success) return { reading: parsed.data, fromCache: true, costUsd: 0 };
  }
  const { jpeg } = await prepareForVision(original);
  const res = await (deps.vision ?? readCardWithClaude)(jpeg);
  db.insert(visionCache)
    .values({ imageHash, model: res.model, rawJson: JSON.stringify(res.reading), inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd })
    .onConflictDoNothing()
    .run();
  return { reading: res.reading, fromCache: false, costUsd: res.costUsd };
}

/** Identification complète d'une photo : lecture, catalogue, secours image. */
export async function identifyImage(db: Db, imageHash: string, image: Buffer, deps: PipelineDeps = {}): Promise<IdentifyResult> {
  const { reading, fromCache, costUsd } = await readWithCache(db, imageHash, image, deps);
  let identity = resolveIdentity(db, reading);
  const ambiguous = identity.candidates.length > 1 && (identity.method === "image" || identity.confidence < 0.8);
  if (deps.imageFallback !== false && ambiguous) {
    const reranked = await rerankByImage(db, image, identity.candidates, { fetch: deps.fetch, cacheDir: config.cacheDir });
    const top = reranked[0]!;
    const second = reranked[1];
    if (top.cardKey !== identity.cardKey || ("imageDistance" in top && top.imageDistance !== undefined)) {
      const decisive = "imageDistance" in top && top.imageDistance !== undefined && top.imageDistance <= IMAGE_MATCH_STRONG && (!second || top.score - second.score >= 0.15);
      const base = { ...identity, candidates: reranked };
      if (top.cardKey !== identity.cardKey) {
        Object.assign(base, {
          setId: top.setId,
          setName: top.setName,
          number: top.number,
          name: top.name,
          variant: top.variant,
          cardKey: top.cardKey,
          catalogKey: top.catalogKey,
          imageUrl: top.imageUrl,
        });
      }
      base.confidence = decisive ? Math.max(identity.confidence, Math.min(0.85, top.score)) : Math.min(identity.confidence, 0.5);
      base.warnings = decisive ? identity.warnings.filter((w) => !w.startsWith("Plusieurs cartes")) : identity.warnings;
      if (decisive) base.method = identity.method === "image" ? "image" : identity.method;
      identity = base;
    }
  }
  learnEnglishName(db, reading, identity);
  return { reading, identity, fromCache, costUsd };
}

/** Le catalogue japonais n'a pas de noms anglais : on garde celui lu par Claude quand l'identification est sûre. */
function learnEnglishName(db: Db, reading: VisionReading, identity: CardIdentity) {
  if (!identity.catalogKey || !reading.name_english || identity.confidence < 0.9 || reading.confidence.name < 0.9) return;
  db.update(catalogCards)
    .set({ nameEn: reading.name_english })
    .where(and(eq(catalogCards.cardKey, identity.catalogKey), isNull(catalogCards.nameEn)))
    .run();
  if (!identity.nameEn) identity.nameEn = reading.name_english;
}

/** Traite une capture de la file : identifie la carte et met à jour l'item de session. */
export async function processCapture(db: Db, captureId: number, deps: PipelineDeps = {}): Promise<IdentifyResult | null> {
  const cap = db.select().from(captures).where(eq(captures.id, captureId)).get();
  if (!cap || cap.side !== "front") return null;
  db.update(captures)
    .set({ status: "processing", attempts: sql`${captures.attempts} + 1`, error: null })
    .where(eq(captures.id, captureId))
    .run();
  try {
    const image = await fs.readFile(path.join(config.dataDir, cap.imagePath));
    const res = await identifyImage(db, cap.imageHash, image, deps);
    db.insert(identifications)
      .values({
        captureId,
        cardKey: res.identity.cardKey,
        confidence: res.identity.confidence,
        candidatesJson: JSON.stringify(res.identity.candidates),
        rawVisionJson: JSON.stringify(res.reading),
        identityJson: JSON.stringify(res.identity),
        visionCalls: res.fromCache ? 0 : 1,
        costUsd: res.costUsd,
      })
      .onConflictDoUpdate({
        target: identifications.captureId,
        set: {
          cardKey: res.identity.cardKey,
          confidence: res.identity.confidence,
          candidatesJson: JSON.stringify(res.identity.candidates),
          rawVisionJson: JSON.stringify(res.reading),
          identityJson: JSON.stringify(res.identity),
          visionCalls: sql`${identifications.visionCalls} + ${res.fromCache ? 0 : 1}`,
          costUsd: sql`${identifications.costUsd} + ${res.costUsd}`,
          userCorrected: false,
          updatedAt: new Date().toISOString(),
        },
      })
      .run();
    await attachSlabCert(db, res, deps);
    if (cap.sessionItemId) setItemIdentity(db, cap.sessionItemId, res.identity);
    db.update(captures).set({ status: "done" }).where(eq(captures.id, captureId)).run();
    return res;
  } catch (e) {
    db.update(captures)
      .set({ status: "error", error: e instanceof Error ? e.message : String(e) })
      .where(eq(captures.id, captureId))
      .run();
    throw e;
  }
}

/**
 * Slab photographié : le numéro de certificat lu sur l'étiquette donne la référence PSA exacte de la carte.
 * On le rattache directement à la carte identifiée, si l'identité est sûre.
 */
async function attachSlabCert(db: Db, res: IdentifyResult, deps: PipelineDeps) {
  const cert = res.reading.slab_cert_number?.replace(/\D/g, "");
  if (!res.reading.is_graded_slab || !cert || cert.length < 7) return;
  const token = deps.psaToken !== undefined ? deps.psaToken : config.psaToken;
  if (!token) {
    res.identity.warnings.push(`Slab détecté (certificat ${cert}) : ajoute PSA_API_TOKEN dans .env pour l'importer automatiquement`);
    return;
  }
  if (res.identity.confidence < 0.8) {
    res.identity.warnings.push(`Slab détecté (certificat ${cert}) : identité à confirmer avant de le rattacher (bouton « Référence par un slab »)`);
    return;
  }
  try {
    const { cert: data } = await attachCert(db, cert, res.identity.cardKey, { token, fetch: deps.fetch });
    const sim = subjectMatches(data.Subject ?? "", res.identity, data.CardNumber);
    if (sim < 0.6) {
      unlinkCard(db, res.identity.cardKey);
      res.identity.warnings.push(`Le certificat ${cert} (${data.Subject}) ne ressemble pas à la carte identifiée : non rattaché, à vérifier`);
    }
  } catch (e) {
    res.identity.warnings.push(`Slab ${cert} : ${e instanceof Error ? e.message : e}`);
  }
}

export function pendingCaptureIds(db: Db, sessionId?: string): number[] {
  return db
    .select({ id: captures.id })
    .from(captures)
    .where(sql`${captures.side} = 'front' and ${captures.status} in ('pending', 'processing') ${sessionId ? sql`and ${captures.sessionId} = ${sessionId}` : sql``}`)
    .orderBy(captures.id)
    .all()
    .map((r) => r.id);
}

export function resetErrored(db: Db, sessionId: string): number[] {
  const ids = db
    .select({ id: captures.id })
    .from(captures)
    .where(sql`${captures.sessionId} = ${sessionId} and ${captures.status} = 'error'`)
    .all()
    .map((r) => r.id);
  if (ids.length) db.update(captures).set({ status: "pending", error: null }).where(inArray(captures.id, ids)).run();
  return ids;
}
