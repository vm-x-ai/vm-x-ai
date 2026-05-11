import { describe, expect, it, vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { GateService } from './gate.service';
import { CompletionError } from './completion.types';
import {
  CapacityDimension,
  CapacityEntity,
  CapacityPeriod,
} from '../capacity/capacity.entity';

/**
 * Unit tests for {@link GateService}'s pure capacity-check logic. The
 * `requestGate` orchestration coordinates Redis + DB + prioritization;
 * we cover the leaf decision (`checkRequestCapacity`) here and leave
 * the full multi-collaborator integration to a separate spec.
 *
 * Wrong behaviour here either lets traffic exceed configured limits
 * (over-spending, breached SLAs) or rejects legitimate requests
 * (false-positive 429s) — both are billing-adjacent regressions.
 */

function buildGate(): GateService {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
  // The tests below only call `checkRequestCapacity`, which doesn't
  // touch any of the injected collaborators — pass `undefined as any`
  // for them. If a future test starts using `requestGate`, real
  // mocks would be added here.
  return new GateService(
    logger,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never
  );
}

const cap = (overrides: Partial<CapacityEntity>): CapacityEntity =>
  ({
    period: CapacityPeriod.MINUTE,
    requests: undefined,
    tokens: undefined,
    ...overrides,
  } as CapacityEntity);

// `checkRequestCapacity` is private; bracket-cast to drive it from
// outside. Each call returns void on allow and throws on deny.
type Check = (
  capacity: CapacityEntity,
  capacityResource: string,
  totalRequests: number,
  usedTokens: number,
  requestTokens: number,
  remainingSeconds: number,
  capacityDimensionValue?: string
) => void;
const getCheck = (g: GateService): Check =>
  (g as unknown as { checkRequestCapacity: Check }).checkRequestCapacity.bind(
    g
  );

describe('GateService.checkRequestCapacity', () => {
  describe('request limit', () => {
    it('allows under the request cap', () => {
      const check = getCheck(buildGate());
      expect(() =>
        check(cap({ requests: 100 }), 'resource', 50, 0, 100, 60)
      ).not.toThrow();
    });

    it('allows at the request cap (boundary inclusive)', () => {
      const check = getCheck(buildGate());
      // The check fires only when totalRequests *exceeds* the cap, so
      // a totalRequests count equal to the cap is still permitted.
      expect(() =>
        check(cap({ requests: 100 }), 'resource', 100, 0, 100, 60)
      ).not.toThrow();
    });

    it('throws CompletionError(429) when over the request cap', () => {
      const check = getCheck(buildGate());
      try {
        check(cap({ requests: 100 }), 'resource', 101, 0, 100, 60);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CompletionError);
        const ce = err as CompletionError;
        expect(ce.data.statusCode).toBe(429);
        expect(ce.data.rate).toBe(true);
        expect(ce.data.retryable).toBe(true);
        expect(ce.data.openAICompatibleError?.code).toBe('resource_exhausted');
      }
    });

    it('does not enforce when the request cap is 0 / undefined (unlimited)', () => {
      const check = getCheck(buildGate());
      expect(() =>
        check(cap({ requests: 0 }), 'resource', 1_000_000, 0, 100, 60)
      ).not.toThrow();
      expect(() =>
        check(cap({}), 'resource', 1_000_000, 0, 100, 60)
      ).not.toThrow();
    });
  });

  describe('token limit', () => {
    it('allows when used + request tokens are under the cap', () => {
      const check = getCheck(buildGate());
      expect(() =>
        check(cap({ tokens: 1000 }), 'resource', 0, 500, 400, 60)
      ).not.toThrow();
    });

    it('allows at the boundary (used + request === cap)', () => {
      const check = getCheck(buildGate());
      expect(() =>
        check(cap({ tokens: 1000 }), 'resource', 0, 600, 400, 60)
      ).not.toThrow();
    });

    it('throws when used + request tokens exceed the cap', () => {
      const check = getCheck(buildGate());
      try {
        check(cap({ tokens: 1000 }), 'resource', 0, 700, 400, 60);
        throw new Error('expected throw');
      } catch (err) {
        const ce = err as CompletionError;
        expect(ce.data.statusCode).toBe(429);
        expect(ce.data.failureReason).toContain('tokens');
      }
    });
  });

  describe('retry-after metadata', () => {
    it('attaches retryDelay (ms) when remainingSeconds > 0', () => {
      const check = getCheck(buildGate());
      try {
        check(cap({ requests: 1 }), 'resource', 5, 0, 1, 30);
      } catch (err) {
        expect((err as CompletionError).data.retryDelay).toBe(30_000);
      }
    });

    it('omits retryDelay when remainingSeconds is 0 (lifetime caps)', () => {
      const check = getCheck(buildGate());
      try {
        check(cap({ requests: 1 }), 'resource', 5, 0, 1, 0);
      } catch (err) {
        expect((err as CompletionError).data.retryDelay).toBeUndefined();
      }
    });
  });

  describe('SOURCE_IP dimension', () => {
    it('embeds the source-IP value in the error message prefix', () => {
      const check = getCheck(buildGate());
      try {
        check(
          cap({
            requests: 1,
            dimension: CapacityDimension.SOURCE_IP,
          } as CapacityEntity),
          'connection',
          5,
          0,
          1,
          60,
          '203.0.113.10'
        );
      } catch (err) {
        const ce = err as CompletionError;
        expect(ce.data.message).toContain('Source IP 203.0.113.10');
      }
    });

    it('falls back to the generic "Resource" prefix without a dimension value', () => {
      const check = getCheck(buildGate());
      try {
        check(
          cap({ requests: 1 } as CapacityEntity),
          'connection',
          5,
          0,
          1,
          60
        );
      } catch (err) {
        const ce = err as CompletionError;
        expect(ce.data.message).toContain('Resource has reached');
      }
    });
  });

  describe('error message includes period and source level', () => {
    it('embeds capacityResource (e.g. "connection") and capacity.period', () => {
      const check = getCheck(buildGate());
      try {
        check(
          cap({ requests: 1, period: CapacityPeriod.HOUR }),
          'connection',
          2,
          0,
          1,
          3600
        );
      } catch (err) {
        const ce = err as CompletionError;
        expect(ce.data.message).toContain('connection');
        expect(ce.data.message).toContain(CapacityPeriod.HOUR);
      }
    });
  });
});
