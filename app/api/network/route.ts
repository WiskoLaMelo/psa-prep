import os from "node:os";
import { handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Adresses de l'ordinateur sur le réseau local, pour ouvrir l'application depuis le téléphone. */
export async function GET(req: Request) {
  return handle(() => {
    const url = new URL(req.url);
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((a): a is os.NetworkInterfaceInfo => Boolean(a) && a!.family === "IPv4" && !a!.internal)
      .map((a) => a.address);
    return json({ protocol: url.protocol.replace(":", ""), port: url.port || (url.protocol === "https:" ? "443" : "80"), host: url.hostname, addresses });
  });
}
