/**
 * Shared OpenAI ↔ Anthropic reasoning-effort / thinking-budget
 * conversion. Centralises the mapping every Anthropic-family provider
 * used to inline; the three previous copies (in this adapter, in
 * `anthropic/openai-response.provider.ts`, and in
 * `aws-bedrock-converse/openai-response.provider.ts`) all routed
 * through subtly different scales, so a request with the same
 * `reasoning_effort` produced different thinking budgets depending on
 * which provider it hit.
 *
 * OpenAI's `reasoning_effort` / `reasoning.effort` is a coarse
 * enum (`minimal`/`low`/`medium`/`high`). Anthropic's thinking config
 * is an integer `budget_tokens` (with a 1024-token floor). The
 * conversion picks conservative defaults and optionally clamps to
 * `max_tokens - 1` so the budget never exceeds the request's overall
 * generation cap.
 */

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/**
 * Anthropic's documented thinking floor; budgets below this are
 * rejected with a 400.
 */
export const ANTHROPIC_THINKING_BUDGET_FLOOR = 1024;

const EFFORT_TO_BUDGET: Record<Exclude<ReasoningEffort, 'minimal'>, number> = {
  low: ANTHROPIC_THINKING_BUDGET_FLOOR,
  medium: 4096,
  high: 16384,
};

/**
 * Map an OpenAI-shape `reasoning_effort` / `reasoning.effort` value
 * to an Anthropic `budget_tokens` integer. Returns `null` for
 * unrecognised input and for `'minimal'` (which the Anthropic side
 * treats as disabled thinking — callers that need the
 * `{ type: 'disabled' }` form construct it themselves).
 *
 * When `maxTokens` is provided, the returned budget is clamped to
 * `[1024, maxTokens - 1]` so the thinking budget never exceeds the
 * request's overall generation cap.
 */
export function reasoningEffortToBudget(
  effort: ReasoningEffort | string | null | undefined,
  maxTokens?: number
): number | null {
  if (!effort || effort === 'minimal') return null;
  const raw = EFFORT_TO_BUDGET[effort as Exclude<ReasoningEffort, 'minimal'>];
  if (raw == null) return null;
  if (maxTokens != null) {
    return Math.max(
      ANTHROPIC_THINKING_BUDGET_FLOOR,
      Math.min(raw, maxTokens - 1)
    );
  }
  return raw;
}

/**
 * Inverse mapping: given a native Anthropic `budget_tokens`, pick the
 * closest OpenAI `reasoning.effort` tier. Used by the OpenAI
 * provider's Anthropic-input adapter to express native thinking
 * budgets through OpenAI Responses' coarse `effort` knob.
 *
 * Bin edges match `reasoningEffortToBudget`'s scale (low=1024,
 * medium=4096, high=16384) — a round-trip
 * effort → budget → effort preserves the tier.
 */
export function reasoningBudgetToEffort(
  budget: number
): 'low' | 'medium' | 'high' {
  if (budget <= 2048) return 'low';
  if (budget <= 8192) return 'medium';
  return 'high';
}
