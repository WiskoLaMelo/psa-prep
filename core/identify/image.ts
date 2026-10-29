import sharp from "sharp";
import crypto from "node:crypto";

export const sha256 = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex");

/**
 * Prépare la photo pour la lecture : orientation EXIF, recadrage sur la carte (fond sombre uni),
 * version réduite en JPEG. Le recadrage est abandonné s'il ne laisse qu'une petite zone.
 */
export async function prepareForVision(input: Buffer, maxEdge = 1568): Promise<{ jpeg: Buffer; width: number; height: number; cropped: boolean }> {
  const oriented = await sharp(input).rotate().toBuffer({ resolveWithObject: true });
  let img = oriented.data;
  let cropped = false;
  try {
    const trimmed = await sharp(img).trim({ threshold: 40 }).toBuffer({ resolveWithObject: true });
    const area = trimmed.info.width * trimmed.info.height;
    const ratio = Math.max(trimmed.info.width, trimmed.info.height) / Math.min(trimmed.info.width, trimmed.info.height);
    // Une carte fait environ 63 × 88 mm (ratio 1,4) ; on garde le recadrage s'il est plausible.
    if (area > 0.15 * oriented.info.width * oriented.info.height && ratio > 1.2 && ratio < 1.65) {
      img = trimmed.data;
      cropped = true;
    }
  } catch {
    // trim échoue sur une image uniforme : on garde l'original.
  }
  const out = await sharp(img)
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: out.data, width: out.info.width, height: out.info.height, cropped };
}

export async function thumbnail(input: Buffer, width = 240): Promise<Buffer> {
  return sharp(input).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
}

/**
 * Hash perceptuel (dHash 128 bits : gradients horizontaux puis verticaux, en hexadécimal).
 * Proche pour deux photos de la même illustration, insensible à la taille et à la compression.
 */
export async function dHash(input: Buffer): Promise<string> {
  const gray = sharp(input).rotate().grayscale();
  const h = await gray.clone().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  const v = await gray.clone().resize(8, 9, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (h[y * 9 + x]! > h[y * 9 + x + 1]! ? 1n : 0n);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (v[y * 8 + x]! > v[(y + 1) * 8 + x]! ? 1n : 0n);
  return bits.toString(16).padStart(32, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Zone d'illustration (haut de la carte), plus discriminante que la carte entière pour le hash. */
export async function artworkRegion(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input).rotate().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  return sharp(data)
    .extract({ left: Math.round(w * 0.08), top: Math.round(h * 0.1), width: Math.round(w * 0.84), height: Math.round(h * 0.42) })
    .toBuffer();
}
