import { describe, expect, it, vi } from 'vitest';
import { CostService } from '../../gateway/cost/cost.service';

/**
 * Cost calculation regressions for Phase 12.
 *
 * Two recent changes affect billing accuracy:
 *
 *   1. Cache-creation tokens are subtracted from base prompt tokens
 *      so we don't double-bill (the cache-write rate already covers
 *      them).
 *   2. Anthropic's published cache-write multipliers (1.25× for 5m
 *      ephemeral, 2× for 1h ephemeral) are applied per-TTL when the
 *      breakdown is reported, falling back to the 5m multiplier when
 *      only the aggregate `cache_creation_input_tokens` is known.
 *
 * Both have direct dollar impact — silent regressions here would
 * either over- or under-bill customers.
 */
describe('CostService.calculate / cache_creation pricing', () => {
  function build(
    pricing: {
      inputCostPerToken: number;
      outputCostPerToken: number;
      cachedInputCostPerToken?: number;
      reasoningCostPerToken?: number;
    } | null
  ): CostService {
    const service = new CostService(
      {
        getByProviderModel: vi
          .fn()
          .mockResolvedValue(pricing ? { ...pricing } : undefined),
      } as never,
      // PinoLogger stub — spec only exercises pure cost math; warn()
      // is called on missing pricing / non-finite totals which the
      // tests already cover via return-value assertions.
      { warn: vi.fn() } as never
    );
    return service;
  }

  it('subtracts cache_creation tokens from base prompt billing', async () => {
    const service = build({
      inputCostPerToken: 0.000003, // $3/1M
      outputCostPerToken: 0.000015,
      cachedInputCostPerToken: 0.0000003,
    });
    const cost = await service.calculate({
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      promptTokens: 1000,
      outputTokens: 100,
      cachedTokens: 200,
      cacheCreationInputTokens: 300,
    });
    // promptTokens for billing = 1000 - 200 (cached) - 300 (cache write) = 500
    expect(cost?.inputCost).toBeCloseTo(500 * 0.000003, 9);
    // cache write @ 1.25× multiplier (5m default) on 300 tokens
    expect(cost?.cacheCreationCost).toBeCloseTo(300 * 0.000003 * 1.25, 9);
    expect(cost?.cachedCost).toBeCloseTo(200 * 0.0000003, 9);
  });

  it('applies the per-TTL multipliers when ephemeral 5m / 1h breakdown is known', async () => {
    const service = build({
      inputCostPerToken: 0.000003,
      outputCostPerToken: 0.000015,
    });
    const cost = await service.calculate({
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      promptTokens: 5000,
      outputTokens: 50,
      // Aggregate is the sum, but the per-TTL breakdown is what we
      // bill against (5m at 1.25×, 1h at 2×) — so when the breakdown
      // is reported it should drive the cost, not the aggregate.
      cacheCreationInputTokens: 1000,
      cacheCreationEphemeral5mTokens: 800,
      cacheCreationEphemeral1hTokens: 200,
    });
    const expected =
      800 * 0.000003 * 1.25 + // 5m bucket
      200 * 0.000003 * 2.0; //   1h bucket
    expect(cost?.cacheCreationCost).toBeCloseTo(expected, 9);
  });

  it('returns null when no pricing record exists for the model', async () => {
    const service = build(null);
    const cost = await service.calculate({
      provider: 'anthropic',
      model: 'claude-opus-99-9-imaginary',
      promptTokens: 1000,
      outputTokens: 100,
    });
    expect(cost).toBeNull();
  });

  it('rolls cache_creation_cost into total_cost', async () => {
    const service = build({
      inputCostPerToken: 0.000003,
      outputCostPerToken: 0.000015,
      cachedInputCostPerToken: 0.0000003,
    });
    const cost = await service.calculate({
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      promptTokens: 1000,
      outputTokens: 100,
      cachedTokens: 200,
      cacheCreationInputTokens: 100,
    });
    const expectedTotal =
      (cost?.inputCost ?? 0) +
      (cost?.outputCost ?? 0) +
      (cost?.cachedCost ?? 0) +
      (cost?.cacheCreationCost ?? 0);
    expect(cost?.totalCost).toBeCloseTo(expectedTotal, 9);
  });

  it('handles missing cache_creation gracefully (zero cost contribution)', async () => {
    const service = build({
      inputCostPerToken: 0.000003,
      outputCostPerToken: 0.000015,
    });
    const cost = await service.calculate({
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      promptTokens: 100,
      outputTokens: 50,
    });
    expect(cost?.cacheCreationCost).toBe(0);
    expect(cost?.totalCost).toBeCloseTo(100 * 0.000003 + 50 * 0.000015, 9);
  });
});
