import { getJson, HttpError, type FetchLike } from "../util/http";
import type { Game, Lang } from "../types";

/** Réponse de l'API publique PSA (GetByCertNumber). Seuls les champs utilisés sont typés. */
export interface PsaCert {
  CertNumber: string;
  SpecID?: number | string | null;
  SpecNumber?: string | null;
  LabelType?: string | null;
  Year?: string | null;
  Brand?: string | null;
  Category?: string | null;
  CardNumber?: string | null;
  Subject?: string | null;
  Variety?: string | null;
  CardGrade?: string | null;
  GradeDescription?: string | null;
  TotalPopulation?: number | null;
  PopulationHigher?: number | null;
}

interface CertResponse {
  PSACert?: PsaCert;
  IsValidRequest?: boolean;
  ServerMessage?: string;
}

export const PSA_API = "https://api.psacard.com/publicapi";

export class PsaApiError extends Error {}

/** Interroge l'API PSA pour un numéro de certificat. Renvoie null si le certificat n'existe pas. */
export async function fetchCert(certNumber: string, opts: { token: string; fetch?: FetchLike }): Promise<PsaCert | null> {
  const cert = certNumber.replace(/\D/g, "");
  if (!cert) throw new PsaApiError(`Numéro de certificat invalide : ${certNumber}`);
  let res: CertResponse | null;
  try {
    res = await getJson<CertResponse>(`${PSA_API}/cert/GetByCertNumber/${cert}`, {
      fetch: opts.fetch,
      headers: { Authorization: `bearer ${opts.token}` },
      retries: 2,
    });
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw new PsaApiError("Token PSA refusé (PSA_API_TOKEN)");
    if (e instanceof HttpError && e.status === 429) throw new PsaApiError("Limite d'appels PSA atteinte, réessaie plus tard");
    throw e;
  }
  if (!res?.PSACert) {
    if (res?.IsValidRequest === false || res === null) return null;
    throw new PsaApiError(res?.ServerMessage ?? "Réponse PSA inattendue");
  }
  return res.PSACert;
}

/** Libellé tel qu'imprimé sur l'étiquette : année marque #numéro sujet variété. */
export function certLabel(c: Pick<PsaCert, "Year" | "Brand" | "CardNumber" | "Subject" | "Variety">): string {
  return [c.Year, c.Brand, c.CardNumber ? `#${c.CardNumber}` : null, c.Subject, c.Variety]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");
}

export function detectGameLang(brand: string, category?: string | null): { game: Game; lang: Lang } {
  const s = `${brand} ${category ?? ""}`.toUpperCase();
  const game: Game = /ONE PIECE/.test(s) ? "onepiece" : "pokemon";
  const lang: Lang = /JAPANESE|JPN/.test(s) ? "ja" : /FRENCH|FRANCAIS|FRANÇAIS/.test(s) ? "fr" : "en";
  return { game, lang };
}
