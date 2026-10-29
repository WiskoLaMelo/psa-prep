export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON avec quelques tentatives sur les erreurs réseau et 429/5xx. Renvoie null sur 404. */
export async function getJson<T>(
  url: string,
  opts: { fetch?: FetchLike; headers?: Record<string, string>; retries?: number } = {},
): Promise<T | null> {
  const f = opts.fetch ?? fetch;
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await f(url, { headers: { Accept: "application/json", ...opts.headers } });
      if (res.status === 404) return null;
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new HttpError(res.status, `${res.status} ${res.statusText} sur ${url}`);
    } catch (e) {
      if (e instanceof HttpError || attempt >= retries) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Exécute fn sur chaque élément avec une concurrence limitée. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
