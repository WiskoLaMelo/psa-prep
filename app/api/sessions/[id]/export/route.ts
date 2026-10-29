import { exportCsv, exportJson } from "@/core/session/export";
import { getSession } from "@/core/session/service";
import { error, getDb, handle } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const db = getDb();
    const s = getSession(db, id);
    if (!s) return error("Session introuvable", 404);
    const format = new URL(req.url).searchParams.get("format") ?? "csv";
    const base = `psa-${s.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || s.id}`;
    if (format === "json") {
      return new Response(JSON.stringify(exportJson(db, id), null, 2), {
        headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${base}.json"` },
      });
    }
    return new Response(exportCsv(db, id), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` },
    });
  });
}
