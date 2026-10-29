import { listSessions } from "@/core/session/service";
import { corsHeaders, getDb, handle } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  return handle(() => Response.json(listSessions(getDb()), { headers: corsHeaders(req) }));
}
