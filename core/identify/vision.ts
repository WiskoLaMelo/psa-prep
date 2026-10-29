import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "../config";
import { estimateCostUsd } from "./pricing";
import { VISION_SYSTEM_PROMPT, VisionReadingSchema, type VisionReading } from "./reading";

export interface VisionResult {
  reading: VisionReading;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Fonction de lecture injectable (remplacée par un faux dans les tests). */
export type VisionReader = (jpeg: Buffer) => Promise<VisionResult>;

export class VisionRefusalError extends Error {}

let client: Anthropic | null = null;

/** Lecture d'une carte par Claude vision, sortie JSON validée par le schéma zod. */
export const readCardWithClaude: VisionReader = async (jpeg) => {
  client ??= new Anthropic();
  const model = config.anthropicModel;
  const usesFallback = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/.test(model);
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    output_config: { effort: config.anthropicEffort, format: betaZodOutputFormat(VisionReadingSchema) },
    // En cas de refus du modèle principal, l'API relance la même requête sur un modèle de secours.
    ...(usesFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    system: VISION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
          { type: "text", text: "Lis cette carte et remplis tous les champs." },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new VisionRefusalError("Lecture refusée par le modèle");
  if (response.stop_reason === "max_tokens") throw new Error("Réponse tronquée (max_tokens)");
  if (!response.parsed_output) throw new Error("Réponse vision illisible");
  const inputTokens = response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0);
  const outputTokens = response.usage.output_tokens;
  return {
    reading: response.parsed_output,
    model: response.model,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(response.model, inputTokens, outputTokens),
  };
};
