import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_THINKING_BUDGET_FLOOR,
  reasoningBudgetToEffort,
  reasoningEffortToBudget,
} from './anthropic-reasoning';

describe('reasoningEffortToBudget', () => {
  it('maps the coarse effort enum to tiered budgets', () => {
    expect(reasoningEffortToBudget('low')).toBe(1024);
    expect(reasoningEffortToBudget('medium')).toBe(4096);
    expect(reasoningEffortToBudget('high')).toBe(16384);
  });

  it('returns null for unrecognised input', () => {
    expect(reasoningEffortToBudget(undefined)).toBeNull();
    expect(reasoningEffortToBudget(null)).toBeNull();
    expect(reasoningEffortToBudget('bogus')).toBeNull();
  });

  it("treats 'minimal' as disabled (returns null)", () => {
    expect(reasoningEffortToBudget('minimal')).toBeNull();
  });

  it('clamps to max_tokens - 1 when max_tokens is supplied', () => {
    // high (16384) > maxTokens (4096) → clamp to 4095.
    expect(reasoningEffortToBudget('high', 4096)).toBe(4095);
    // medium (4096) > maxTokens (2048) → clamp to 2047.
    expect(reasoningEffortToBudget('medium', 2048)).toBe(2047);
  });

  it('never falls below the Anthropic thinking floor', () => {
    // maxTokens=200 would push high to 199, but the floor is 1024.
    expect(reasoningEffortToBudget('high', 200)).toBe(
      ANTHROPIC_THINKING_BUDGET_FLOOR
    );
  });

  it('passes the raw tier through when max_tokens is omitted', () => {
    expect(reasoningEffortToBudget('high')).toBe(16384);
  });
});

describe('reasoningBudgetToEffort (inverse)', () => {
  it('bins by tier breakpoints aligned with effortToBudget', () => {
    expect(reasoningBudgetToEffort(1024)).toBe('low');
    expect(reasoningBudgetToEffort(2048)).toBe('low');
    expect(reasoningBudgetToEffort(2049)).toBe('medium');
    expect(reasoningBudgetToEffort(8192)).toBe('medium');
    expect(reasoningBudgetToEffort(8193)).toBe('high');
    expect(reasoningBudgetToEffort(16384)).toBe('high');
    expect(reasoningBudgetToEffort(99999)).toBe('high');
  });
});
