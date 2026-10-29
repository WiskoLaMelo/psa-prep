import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, "dist");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await build({
  entryPoints: { background: path.join(here, "src/background.ts"), popup: path.join(here, "src/popup.ts") },
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir: out,
  logLevel: "info",
});
// content.js est injecté par chrome.scripting.executeScript : il doit être un script classique, pas un module.
await build({ entryPoints: [path.join(here, "src/content.ts")], bundle: true, format: "iife", target: "chrome120", outfile: path.join(out, "content.js") });

for (const f of ["manifest.json", "popup.html"]) fs.copyFileSync(path.join(here, f), path.join(out, f));
console.log(`Extension prête dans ${out} : chrome://extensions → Mode développeur → Charger l'extension non empaquetée.`);
