import { config } from "@/core/config";
import { totalVisionCost } from "@/core/session/service";
import { getDb, handle, json } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() =>
    json({
      captureStableMs: config.captureStableMs,
      hasAnthropicKey: config.hasAnthropicKey,
      hasPsaToken: Boolean(config.psaToken),
      model: config.anthropicModel,
      effort: config.anthropicEffort,
      psaPagesFetchEnabled: config.psaPagesFetchEnabled,
      totals: totalVisionCost(getDb()),
    }),
  );
}
