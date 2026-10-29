import path from "node:path";

const env = (name: string) => process.env[name]?.trim() || undefined;

/** Configuration lue dans .env (voir .env.example). Les getters relisent l'environnement à chaque accès. */
export const config = {
  get dataDir() {
    return path.resolve(env("DATA_DIR") ?? "./data");
  },
  get dbFile() {
    return path.join(this.dataDir, "psa-prep.sqlite");
  },
  get imagesDir() {
    return path.join(this.dataDir, "images");
  },
  get cacheDir() {
    return path.join(this.dataDir, "cache");
  },
  get anthropicModel() {
    return env("ANTHROPIC_MODEL") ?? "claude-opus-5-5";
  },
  get anthropicEffort(): "low" | "medium" | "high" | "xhigh" | "max" {
    const v = env("ANTHROPIC_EFFORT");
    return v === "low" || v === "high" || v === "xhigh" || v === "max" ? v : "medium";
  },
  get hasAnthropicKey() {
    return Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN"));
  },
  get psaToken() {
    return env("PSA_API_TOKEN");
  },
  get psaApiDelayMs() {
    return Number(env("PSA_API_DELAY_MS") ?? 1500);
  },
  get captureStableMs() {
    return Number(env("CAPTURE_STABLE_MS") ?? 600);
  },
  get psaPagesFetchEnabled() {
    return env("PSA_PAGES_FETCH_ENABLED") === "true";
  },
};
