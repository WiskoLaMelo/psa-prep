/**
 * npm run phone — lance l'application en HTTPS pour scanner avec un téléphone sur le même Wi-Fi.
 * Génère un certificat qui couvre localhost et les adresses réseau de l'ordinateur, puis affiche
 * l'adresse et un QR code à scanner avec l'appareil photo du téléphone.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { generate } from "selfsigned";

const port = process.env.PORT ?? "3000";
const dir = path.resolve("certificates");
const keyFile = path.join(dir, "phone-key.pem");
const certFile = path.join(dir, "phone-cert.pem");
const metaFile = path.join(dir, "phone-cert.json");

const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((a): a is os.NetworkInterfaceInfo => Boolean(a) && a!.family === "IPv4" && !a!.internal)
  .map((a) => a.address);

async function ensureCert() {
  const wanted = ["127.0.0.1", ...ips].sort().join(",");
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as { ips: string; expires: number };
    if (meta.ips === wanted && meta.expires > Date.now() && fs.existsSync(keyFile) && fs.existsSync(certFile)) return;
  } catch {
    // Pas encore de certificat, ou adresses changées : on le régénère.
  }
  const notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const pems = await generate([{ name: "commonName", value: "psa-prep.local" }], {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: notAfter,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [{ type: 2, value: "localhost" }, ...["127.0.0.1", ...ips].map((ip) => ({ type: 7 as const, ip }))],
      },
    ],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(metaFile, JSON.stringify({ ips: wanted, expires: notAfter.getTime() }));
}

await ensureCert();
const urls = ips.map((ip) => `https://${ip}:${port}`);
console.log("\nPSA Prep — scan avec le téléphone\n");
if (!urls.length) console.log("Aucune adresse réseau trouvée : l'ordinateur est-il connecté au Wi-Fi ?");
for (const u of urls) {
  console.log(await QRCode.toString(u, { type: "terminal", small: true }));
  console.log(`  ${u}\n`);
}
console.log("1. Téléphone et ordinateur sur le même Wi-Fi.");
console.log("2. Scanne le QR code avec l'appareil photo du téléphone.");
console.log("3. Première fois : accepte l'avertissement de certificat (Android : Paramètres avancés → Continuer ; iPhone : Afficher les détails → visiter ce site web).");
console.log("4. Si l'ordinateur bloque la connexion, autorise Node.js dans son pare-feu.\n");

const next = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "-H", "0.0.0.0", "-p", port, "--experimental-https", "--experimental-https-key", keyFile, "--experimental-https-cert", certFile],
  { stdio: "inherit", shell: process.platform === "win32" },
);
next.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => next.kill(sig));
