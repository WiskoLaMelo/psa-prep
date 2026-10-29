/**
 * Capture automatique : on capture quand l'image reste stable pendant stableMs,
 * puis on attend un changement net (carte retirée ou remplacée) avant de réarmer.
 * Logique pure, alimentée par l'écran de scan à chaque image analysée.
 */
export interface StabilityOptions {
  stableMs: number;
  /** Écart moyen (0–255) entre deux images consécutives en dessous duquel l'image est « immobile ». */
  stillThreshold: number;
  /** Écart avec l'image capturée au-dessus duquel on considère que la carte a changé. */
  changeThreshold: number;
  /** Écart avec le fond vide en dessous duquel il n'y a pas de carte sous la caméra. */
  emptyThreshold: number;
}

export const DEFAULT_STABILITY: StabilityOptions = { stableMs: 600, stillThreshold: 4, changeThreshold: 18, emptyThreshold: 10 };

export type CaptureState = "waiting" | "settling" | "captured";

export interface FrameMetrics {
  /** Écart avec l'image précédente. */
  motion: number;
  /** Écart avec l'image au moment de la dernière capture (null si aucune). */
  diffFromLastCapture: number | null;
  /** Écart avec le fond vide de référence (null si non calibré). */
  diffFromBackground: number | null;
}

export class AutoCapture {
  state: CaptureState = "waiting";
  private stillSince: number | null = null;

  constructor(public opts: StabilityOptions = DEFAULT_STABILITY) {}

  /** Renvoie true quand il faut déclencher une capture maintenant. */
  update(m: FrameMetrics, now: number): boolean {
    const hasCard = m.diffFromBackground === null || m.diffFromBackground > this.opts.emptyThreshold;
    if (this.state === "captured") {
      // Réarmement : la carte a été retirée (retour au fond) ou l'image a nettement changé.
      const changed = m.diffFromLastCapture === null || m.diffFromLastCapture > this.opts.changeThreshold || !hasCard;
      if (changed) {
        this.state = "waiting";
        this.stillSince = null;
      }
      return false;
    }
    if (!hasCard || m.motion > this.opts.stillThreshold) {
      this.state = "waiting";
      this.stillSince = null;
      return false;
    }
    if (this.stillSince === null) {
      this.stillSince = now;
      this.state = "settling";
      return false;
    }
    if (now - this.stillSince >= this.opts.stableMs) {
      this.state = "captured";
      this.stillSince = null;
      return true;
    }
    return false;
  }

  /** Après une capture manuelle : même comportement qu'une capture automatique. */
  markCaptured() {
    this.state = "captured";
    this.stillSince = null;
  }

  /** Progression du délai de stabilité, de 0 à 1 (pour l'affichage). */
  progress(now: number): number {
    if (this.state !== "settling" || this.stillSince === null) return this.state === "captured" ? 1 : 0;
    return Math.min(1, (now - this.stillSince) / this.opts.stableMs);
  }
}

/** Écart moyen absolu entre deux images en niveaux de gris de même taille. */
export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / n;
}

/** RGBA → niveaux de gris. */
export function toGray(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.floor(rgba.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = (rgba[i * 4]! * 77 + rgba[i * 4 + 1]! * 150 + rgba[i * 4 + 2]! * 29) >> 8;
  return out;
}
