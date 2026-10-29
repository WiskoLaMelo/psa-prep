import { createSession, listSessions } from "@/core/session/service";
import { getDb, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => json(listSessions(getDb())));
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    return json(createSession(getDb(), body.name), { status: 201 });
  });
}
