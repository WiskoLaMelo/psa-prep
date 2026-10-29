/** Tarifs publics en dollars par million de jetons (entrée, sortie). Mettre à jour si les prix changent. */
const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const [inp, out] = PRICES[model] ?? PRICES["claude-opus-5-5"]!;
  return (inputTokens * inp + outputTokens * out) / 1_000_000;
}
