import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ModelPricingService } from '../../model-pricing/model-pricing.service';
import { CompletionCostBreakdown } from '../../audit/entities/audit.entity';

export interface CostCalculationInput {
  provider: string;
  model: string;
  promptTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  reasoningTokens?: number | null;
  /**
   * Tokens used to *write* prompt-cache entries (Anthropic). Bills
   * separately from cached reads — typically 1.25× regular input
   * tokens for 5-minute ephemeral, 2× for 1-hour. We use the per-TTL
   * breakdown when available; falling back to the base input rate
   * when no cache-write multipliers are configured for the model.
   */
  cacheCreationInputTokens?: number | null;
  cacheCreationEphemeral5mTokens?: number | null;
  cacheCreationEphemeral1hTokens?: number | null;
}

// Anthropic's published cache-write multipliers, applied as a multiple
// of the regular `inputCostPerToken` when the pricing record doesn't
// yet have explicit per-TTL columns. These match the rates documented
// at https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching.
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2.0;

/**
 * Coerce a possibly-undefined / negative / NaN / Infinity token count
 * to a finite non-negative integer. Upstream providers occasionally
 * report bogus values on error paths; we'd rather record `0` than
 * propagate `NaN` into the audit row's cost JSONB.
 */
function safeNonNegative(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

@Injectable()
export class CostService {
  constructor(
    private readonly modelPricingService: ModelPricingService,
    private readonly logger: PinoLogger
  ) {}

  async calculate(
    input: CostCalculationInput
  ): Promise<CompletionCostBreakdown | null> {
    const pricing = await this.modelPricingService
      .getByProviderModel(input.provider, input.model)
      .catch(() => undefined);
    if (!pricing) {
      // Surface missing pricing so ops can spot models that need a
      // pricing-table entry. Audit rows for these requests record
      // `cost: null` (vs. zero) so dashboards can distinguish
      // "feature unavailable" from "actually zero cost".
      this.logger.warn(
        { provider: input.provider, model: input.model },
        'Model pricing not configured — cost recorded as null'
      );
      return null;
    }

    const cachedTokens = safeNonNegative(input.cachedTokens);
    const reasoningTokens = safeNonNegative(input.reasoningTokens);
    const cacheCreationInputTokens = safeNonNegative(
      input.cacheCreationInputTokens
    );
    const cacheCreationEphemeral5m = safeNonNegative(
      input.cacheCreationEphemeral5mTokens
    );
    const cacheCreationEphemeral1h = safeNonNegative(
      input.cacheCreationEphemeral1hTokens
    );
    // Subtract cache-write tokens from base input cost — Anthropic
    // bills cache writes at the higher cache-write rate, so counting
    // them at the base rate too would double-bill. Cached *reads* are
    // already subtracted via `cachedTokens`.
    const promptTokens = Math.max(
      0,
      safeNonNegative(input.promptTokens) -
        cachedTokens -
        cacheCreationInputTokens
    );
    const outputTokens = Math.max(
      0,
      safeNonNegative(input.outputTokens) - reasoningTokens
    );

    const inputCost = promptTokens * pricing.inputCostPerToken;
    const outputCost = outputTokens * pricing.outputCostPerToken;
    const cachedCost = cachedTokens * (pricing.cachedInputCostPerToken ?? 0);
    const reasoningCost =
      reasoningTokens * (pricing.reasoningCostPerToken ?? 0);
    // Per-TTL pricing when the breakdown is reported; otherwise fall
    // back to the aggregate using the 5m multiplier (most cache writes
    // are 5m ephemeral by default).
    const cacheCreationCost =
      cacheCreationEphemeral5m || cacheCreationEphemeral1h
        ? cacheCreationEphemeral5m *
            pricing.inputCostPerToken *
            CACHE_WRITE_5M_MULTIPLIER +
          cacheCreationEphemeral1h *
            pricing.inputCostPerToken *
            CACHE_WRITE_1H_MULTIPLIER
        : cacheCreationInputTokens *
          pricing.inputCostPerToken *
          CACHE_WRITE_5M_MULTIPLIER;

    const totalCost =
      inputCost + outputCost + cachedCost + reasoningCost + cacheCreationCost;

    // Defence in depth: if pricing record had a non-finite value we
    // didn't catch above, surface that as `null` so we never write
    // `NaN`/`Infinity` into the audit JSONB column.
    if (!Number.isFinite(totalCost) || totalCost < 0) {
      this.logger.warn(
        {
          provider: input.provider,
          model: input.model,
          totalCost,
        },
        'Cost calculation produced non-finite total — recording null'
      );
      return null;
    }

    return {
      inputCost,
      outputCost,
      cachedCost,
      reasoningCost,
      cacheCreationCost,
      totalCost,
      currency: 'USD',
    };
  }
}
