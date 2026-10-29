import { exportJson } from "@/core/session/export";
import { corsHeaders, getDb, handle } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return Response.json(exportJson(getDb(), id), { headers: corsHeaders(req) });
  });
}
