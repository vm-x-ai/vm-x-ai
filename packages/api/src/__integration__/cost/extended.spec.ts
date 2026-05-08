import { describe, expect, it, vi } from 'vitest';
import { CostService } from '../../gateway/cost/cost.service';

/**
 * Extended cost-calculation integration. The companion file
 * (`cost.service.spec.ts` in this directory) covers the Phase-12
 * cache-creation pricing math; this suite focuses on the broader
 * envelope: NaN/Infinity guards, missing-pricing fallback, partial
 * inputs (only prompt or only completion), reasoning tokens, and the
 * warn() side-effect that lets ops dashboards spot models without a
 * pricing row.
 */

function build(
  pricing: {
    inputCostPerToken: number;
    outputCostPerToken: number;
    cachedInputCostPerToken?: number;
    reasoningCostPerToken?: number;
  } | null,
  warn = vi.fn()
): { service: CostService; warn: ReturnType<typeof vi.fn> } {
  const service = new CostService(
    {
      getByProviderModel: vi
        .fn()
        .mockResolvedValue(pricing ? { ...pricing } : undefined),
    } as never,
    { warn } as never
  );
  return { service, warn };
}

describe('CostService — extended', () => {
  describe('missing pricing', () => {
    it('returns null when no pricing row exists', async () => {
      const { service } = build(null);
      const cost = await service.calculate({
        provider: 'newprovider',
        model: 'unmapped-model',
        promptTokens: 100,
        outputTokens: 50,
      });
      expect(cost).toBeNull();
    });

    it('emits a warn() so ops can spot un-priced models', async () => {
      const { service, warn } = build(null);
      await service.calculate({
        provider: 'newprovider',
        model: 'unmapped',
        promptTokens: 100,
      });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'newprovider',
          model: 'unmapped',
        }),
        expect.stringMatching(/pricing not configured/i)
      );
    });

    it('treats a thrown getByProviderModel error as missing pricing (does not crash)', async () => {
      // Defensive: a transient DB hiccup must not fail the completion;
      // we just record `cost: null` for that audit row.
      const service = new CostService(
        {
          getByProviderModel: vi
            .fn()
            .mockRejectedValue(new Error('db connection lost')),
        } as never,
        { warn: vi.fn() } as never
      );
      await expect(
        service.calculate({
          provider: 'openai',
          model: 'gpt-4o-mini',
          promptTokens: 10,
          outputTokens: 5,
        })
      ).resolves.toBeNull();
    });
  });

  describe('partial inputs', () => {
    it('handles prompt-only (completion = 0)', async () => {
      const { service } = build({
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
      });
      const cost = await service.calculate({
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        promptTokens: 1000,
        outputTokens: 0,
      });
      expect(cost?.inputCost).toBeCloseTo(1000 * 0.000003, 9);
      expect(cost?.outputCost).toBe(0);
      expect(cost?.totalCost).toBeCloseTo(1000 * 0.000003, 9);
    });

    it('handles completion-only (prompt = 0)', async () => {
      const { service } = build({
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
      });
      const cost = await service.calculate({
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        promptTokens: 0,
        outputTokens: 200,
      });
      expect(cost?.inputCost).toBe(0);
      expect(cost?.outputCost).toBeCloseTo(200 * 0.000015, 9);
    });

    it('returns zeros when both token counts are zero', async () => {
      const { service } = build({
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
      });
      const cost = await service.calculate({
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        promptTokens: 0,
        outputTokens: 0,
      });
      expect(cost?.totalCost).toBe(0);
    });

    it('treats undefined/null token counts as zero (not NaN)', async () => {
      const { service } = build({
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
      });
      const cost = await service.calculate({
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        promptTokens: undefined,
        outputTokens: null,
      });
      expect(cost?.totalCost).toBe(0);
    });
  });

  describe('NaN / Infinity / negative guards', () => {
    it('coerces negative token counts to 0', async () => {
      const { service } = build({
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
      });
      const cost = await service.calculate({
        provider: 'openai',
        model: 'gpt-4o',
        promptTokens: -5,
        outputTokens: 100,
      });
      expect(cost?.inputCost).toBe(0);
      expect(cost?.outputCost).toBeCloseTo(100 * 0.000015, 9);
    });

    it('coerces NaN to 0', async () => {
      const { service } = build({
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
      });
      const cost = await service.calculate({
        provider: 'openai',
        model: 'gpt-4o',
        promptTokens: Number.NaN,
        outputTokens: 100,
      });
      expect(cost?.inputCost).toBe(0);
    });

    it('coerces Infinity to 0', async () => {
      const { service } = build({
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
      });
      const cost = await service.calculate({
        provider: 'openai',
        model: 'gpt-4o',
        promptTokens: Number.POSITIVE_INFINITY,
        outputTokens: 100,
      });
      expect(cost?.inputCost).toBe(0);
    });
  });

  describe('reasoning tokens', () => {
    it('charges reasoning tokens at the reasoning rate when configured', async () => {
      const { service } = build({
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
        reasoningCostPerToken: 0.00006,
      });
      const cost = await service.calculate({
        provider: 'openai',
        model: 'o1',
        promptTokens: 100,
        outputTokens: 50,
        reasoningTokens: 200,
      });
      expect(cost?.reasoningCost).toBeCloseTo(200 * 0.00006, 9);
    });

    it('does not include reasoning cost when no reasoningTokens reported', async () => {
      const { service } = build({
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
        reasoningCostPerToken: 0.00006,
      });
      const cost = await service.calculate({
        provider: 'openai',
        model: 'o1',
        promptTokens: 100,
        outputTokens: 50,
      });
      // No reasoning tokens → either omitted or zero, but never NaN.
      expect(cost?.reasoningCost ?? 0).toBe(0);
    });
  });

  describe('totalCost composition', () => {
    it('sums input + output + cached + cacheCreation + reasoning', async () => {
      const { service } = build({
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
        cachedInputCostPerToken: 0.0000003,
        reasoningCostPerToken: 0.00006,
      });
      const cost = await service.calculate({
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        promptTokens: 1000,
        outputTokens: 100,
        cachedTokens: 200,
        cacheCreationInputTokens: 300,
        reasoningTokens: 50,
      });
      // Recompute the expected total. Note the implementation
      // subtracts reasoning tokens from completion before charging
      // output rate — billable completion = 100 - 50 reasoning = 50.
      //   base input  = (1000 - 200 cached - 300 cacheWrite) × inRate
      //   cache write = 300 × inRate × 1.25 (5m default)
      //   cached      = 200 × cachedRate
      //   output      = (100 - 50 reasoning) × outRate
      //   reasoning   = 50 × reasoningRate
      const expected =
        500 * 0.000003 +
        300 * 0.000003 * 1.25 +
        200 * 0.0000003 +
        50 * 0.000015 +
        50 * 0.00006;
      expect(cost?.totalCost).toBeCloseTo(expected, 9);
    });

    it('returns null when totalCost is non-finite (defensive)', async () => {
      // Construct pricing rates that would multiply through to NaN —
      // proves the safeNonNegative + final finiteness check actually
      // shields the audit row.
      const { service, warn } = build({
        inputCostPerToken: Number.NaN,
        outputCostPerToken: 0.000015,
      });
      const cost = await service.calculate({
        provider: 'broken',
        model: 'broken-model',
        promptTokens: 100,
        outputTokens: 50,
      });
      expect(cost).toBeNull();
      expect(warn).toHaveBeenCalled();
    });
  });
});
