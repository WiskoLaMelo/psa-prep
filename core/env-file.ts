import fs from "node:fs";
import path from "node:path";

/**
 * Met à jour des variables dans .env (créé depuis .env.example si besoin) sans toucher aux autres lignes,
 * et les applique aussitôt au processus en cours : pas besoin de redémarrer l'application.
 */
export function updateEnvFile(updates: Record<string, string>, dir = process.cwd()) {
  const file = path.join(dir, ".env");
  const example = path.join(dir, ".env.example");
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fs.existsSync(example) ? fs.readFileSync(example, "utf8") : "";
  for (const [key, raw] of Object.entries(updates)) {
    const value = raw.replace(/[\r\n]/g, "").trim();
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, "\n")}${line}\n`;
    process.env[key] = value;
  }
  fs.writeFileSync(file, text);
}
