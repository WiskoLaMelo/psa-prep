import { backup } from "@/core/backup";
import { getDb, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => json({ path: await backup(getDb(), "backups") }));
}
