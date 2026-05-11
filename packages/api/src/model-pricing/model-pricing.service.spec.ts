import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ModelPricingService } from './model-pricing.service';
import type { DatabaseService } from '../storage/database.service';
import { HttpException } from '@nestjs/common';

/**
 * Unit tests for {@link ModelPricingService}. The service sits on the
 * cost-calculation hot path and now keeps an in-memory TTL cache to
 * shield the `model_pricing` table from per-completion thrashing. The
 * tests cover the cache lifecycle (read → cached read → invalidate on
 * mutation), CRUD round-trips, and the not-found 404 path.
 */

type Row = {
  pricingId: string;
  provider: string;
  model: string;
  inputCostPerToken: number;
  outputCostPerToken: number;
  cachedInputCostPerToken?: number | null;
  reasoningCostPerToken?: number | null;
  createdBy?: string;
  updatedBy?: string;
};

/**
 * Build a Kysely-shaped chainable mock — every chain method returns
 * `this` and the terminal methods (`execute`, `executeTakeFirst`,
 * `executeTakeFirstOrThrow`) resolve to whatever the test provides.
 */
function makeQueryChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = [
    'selectFrom',
    'selectAll',
    'select',
    'where',
    'orderBy',
    'insertInto',
    'updateTable',
    'deleteFrom',
    'set',
    'values',
    'returningAll',
    'innerJoin',
    '$if',
  ];
  for (const m of methods) chain[m] = vi.fn(() => chain);
  chain.execute = vi.fn(async () =>
    Array.isArray(result) ? result : [result]
  );
  chain.executeTakeFirst = vi.fn(async () => result);
  chain.executeTakeFirstOrThrow = vi.fn(async () => {
    if (result === undefined) throw new Error('not found');
    return result;
  });
  return chain;
}

function makeDb(read: unknown, write: unknown = read): DatabaseService {
  const reader = makeQueryChain(read);
  const writer = makeQueryChain(write);
  return { reader, writer } as unknown as DatabaseService;
}

const sampleRow: Row = {
  pricingId: '11111111-1111-1111-1111-111111111111',
  provider: 'openai',
  model: 'gpt-4o-mini',
  inputCostPerToken: 0.00000015,
  outputCostPerToken: 0.0000006,
  cachedInputCostPerToken: 0.000000075,
  reasoningCostPerToken: null,
  createdBy: 'seed',
  updatedBy: 'seed',
};

describe('ModelPricingService', () => {
  describe('list', () => {
    it('queries without a provider filter when none is given', async () => {
      const db = makeDb([sampleRow]);
      const svc = new ModelPricingService(db);
      const out = await svc.list();
      expect(out).toEqual([sampleRow]);
      // No `where('provider', ...)` call should have fired without a filter.
      const reader = db.reader as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      expect(reader.where).not.toHaveBeenCalled();
    });

    it('applies the provider filter when supplied', async () => {
      const db = makeDb([sampleRow]);
      const svc = new ModelPricingService(db);
      await svc.list('openai');
      const reader = db.reader as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      expect(reader.where).toHaveBeenCalledWith('provider', '=', 'openai');
    });
  });

  describe('getById', () => {
    it('returns the row when found', async () => {
      const svc = new ModelPricingService(makeDb(sampleRow));
      await expect(svc.getById(sampleRow.pricingId)).resolves.toEqual(
        sampleRow
      );
    });

    it('throws a 404 when not found', async () => {
      const svc = new ModelPricingService(makeDb(undefined));
      await expect(svc.getById(sampleRow.pricingId)).rejects.toBeInstanceOf(
        HttpException
      );
    });
  });

  describe('getByProviderModel cache', () => {
    let db: DatabaseService;
    let svc: ModelPricingService;
    let reader: Record<string, ReturnType<typeof vi.fn>>;

    beforeEach(() => {
      db = makeDb(sampleRow);
      svc = new ModelPricingService(db);
      reader = db.reader as unknown as Record<string, ReturnType<typeof vi.fn>>;
    });

    it('returns the row from the DB on first call', async () => {
      const row = await svc.getByProviderModel('openai', 'gpt-4o-mini');
      expect(row).toEqual(sampleRow);
      expect(reader.executeTakeFirst).toHaveBeenCalledTimes(1);
    });

    it('serves repeat lookups from the cache (no second DB hit)', async () => {
      await svc.getByProviderModel('openai', 'gpt-4o-mini');
      await svc.getByProviderModel('openai', 'gpt-4o-mini');
      await svc.getByProviderModel('openai', 'gpt-4o-mini');
      expect(reader.executeTakeFirst).toHaveBeenCalledTimes(1);
    });

    it('caches an `undefined` (not-found) result so 404s do not thrash the DB', async () => {
      const dbMissing = makeDb(undefined);
      const svcMissing = new ModelPricingService(dbMissing);
      const r1 = await svcMissing.getByProviderModel('openai', 'no-such-model');
      const r2 = await svcMissing.getByProviderModel('openai', 'no-such-model');
      expect(r1).toBeUndefined();
      expect(r2).toBeUndefined();
      const readerMissing = dbMissing.reader as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      expect(readerMissing.executeTakeFirst).toHaveBeenCalledTimes(1);
    });

    it('invalidates the cache after `create`', async () => {
      // Prime the cache.
      await svc.getByProviderModel('openai', 'gpt-4o-mini');
      // Switch the writer to return a fresh row, but the reader still
      // tracks call count — after create() the next lookup must hit
      // the DB again.
      await svc.create(
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputCostPerToken: 0.00000016,
          outputCostPerToken: 0.0000007,
        },
        'tester'
      );
      await svc.getByProviderModel('openai', 'gpt-4o-mini');
      expect(reader.executeTakeFirst).toHaveBeenCalledTimes(2);
    });

    it('invalidates the cache after `update`', async () => {
      await svc.getByProviderModel('openai', 'gpt-4o-mini');
      await svc.update(
        sampleRow.pricingId,
        { inputCostPerToken: 0.00000099 },
        'tester'
      );
      await svc.getByProviderModel('openai', 'gpt-4o-mini');
      expect(reader.executeTakeFirst).toHaveBeenCalledTimes(2);
    });

    it('invalidates the cache after `delete`', async () => {
      await svc.getByProviderModel('openai', 'gpt-4o-mini');
      await svc.delete(sampleRow.pricingId);
      await svc.getByProviderModel('openai', 'gpt-4o-mini');
      expect(reader.executeTakeFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('create', () => {
    it('writes the row and invalidates by (provider, model)', async () => {
      const db = makeDb(undefined, sampleRow);
      const svc = new ModelPricingService(db);
      const created = await svc.create(
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputCostPerToken: 0.00000015,
          outputCostPerToken: 0.0000006,
          cachedInputCostPerToken: 0.000000075,
        },
        'tester'
      );
      expect(created).toEqual(sampleRow);
      const writer = db.writer as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      expect(writer.values).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o-mini',
          createdBy: 'tester',
          updatedBy: 'tester',
        })
      );
    });

    it('defaults cachedInputCostPerToken / reasoningCostPerToken to 0 when omitted', async () => {
      const db = makeDb(undefined, sampleRow);
      const svc = new ModelPricingService(db);
      await svc.create(
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputCostPerToken: 0.00000015,
          outputCostPerToken: 0.0000006,
        },
        'tester'
      );
      const writer = db.writer as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      expect(writer.values).toHaveBeenCalledWith(
        expect.objectContaining({
          cachedInputCostPerToken: 0,
          reasoningCostPerToken: 0,
        })
      );
    });
  });

  describe('update', () => {
    it('omits null/undefined fields from the SET clause', async () => {
      const db = makeDb(undefined, sampleRow);
      const svc = new ModelPricingService(db);
      await svc.update(
        sampleRow.pricingId,
        {
          inputCostPerToken: 0.00000099,
          // These should be filtered out — partial updates must not
          // overwrite columns the caller didn't touch.
          outputCostPerToken: undefined as unknown as number,
          cachedInputCostPerToken: null as unknown as number,
        },
        'tester'
      );
      const writer = db.writer as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      const setArg = writer.set.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(setArg.inputCostPerToken).toBe(0.00000099);
      expect(setArg).not.toHaveProperty('outputCostPerToken');
      expect(setArg).not.toHaveProperty('cachedInputCostPerToken');
      expect(setArg.updatedBy).toBe('tester');
      expect(setArg.updatedAt).toBeInstanceOf(Date);
    });

    it('throws 404 when the pricingId does not exist', async () => {
      const db = makeDb(undefined, undefined);
      const svc = new ModelPricingService(db);
      await expect(
        svc.update(sampleRow.pricingId, { inputCostPerToken: 1 }, 'tester')
      ).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe('importMany', () => {
    /**
     * Build a service whose reader returns `existing` rows on
     * `.execute()`, and whose writer's `.transaction().execute(cb)`
     * invokes `cb` with a tx chain that records every
     * `insertInto/updateTable/values/set/where` call so the tests
     * can assert on the per-row plan.
     */
    function buildImportSvc(existing: ReadonlyArray<Record<string, unknown>>) {
      const ops: Array<{
        kind: 'insert' | 'update';
        values?: Record<string, unknown>;
        set?: Record<string, unknown>;
        where?: { column: string; op: string; value: unknown };
      }> = [];

      const txChain = () => {
        let pending:
          | { kind: 'insert' }
          | {
              kind: 'update';
              where?: { column: string; op: string; value: unknown };
            }
          | undefined;
        let pendingSet: Record<string, unknown> | undefined;
        let pendingValues: Record<string, unknown> | undefined;
        let pendingWhere:
          | { column: string; op: string; value: unknown }
          | undefined;
        const chain: Record<string, ReturnType<typeof vi.fn>> = {};
        chain.insertInto = vi.fn(() => {
          pending = { kind: 'insert' };
          return chain;
        });
        chain.updateTable = vi.fn(() => {
          pending = { kind: 'update' };
          return chain;
        });
        chain.values = vi.fn((v: Record<string, unknown>) => {
          pendingValues = v;
          return chain;
        });
        chain.set = vi.fn((v: Record<string, unknown>) => {
          pendingSet = v;
          return chain;
        });
        chain.where = vi.fn((column: string, op: string, value: unknown) => {
          pendingWhere = { column, op, value };
          return chain;
        });
        chain.execute = vi.fn(async () => {
          if (pending?.kind === 'insert') {
            ops.push({ kind: 'insert', values: pendingValues });
          } else if (pending?.kind === 'update') {
            ops.push({
              kind: 'update',
              set: pendingSet,
              where: pendingWhere,
            });
          }
          pending = undefined;
          pendingSet = undefined;
          pendingValues = undefined;
          pendingWhere = undefined;
          return [];
        });
        return chain;
      };

      const reader = makeQueryChain(existing);
      const writer = {
        transaction: vi.fn(() => ({
          execute: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
            return cb(txChain());
          }),
        })),
      };
      const db = { reader, writer } as unknown as DatabaseService;
      return { svc: new ModelPricingService(db), ops };
    }

    const baseRow = {
      pricingId: '00000000-0000-0000-0000-000000000001',
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputCostPerToken: 0.00000015,
      outputCostPerToken: 0.0000006,
      cachedInputCostPerToken: 0.000000075,
      reasoningCostPerToken: 0,
      source: 'SYSTEM' as const,
    };

    it('inserts new rows as USER (ignores any source value in the file)', async () => {
      const { svc, ops } = buildImportSvc([]);
      const result = await svc.importMany(
        [
          {
            provider: 'anthropic',
            model: 'claude-haiku-4-5',
            inputCostPerToken: 1e-6,
            outputCostPerToken: 5e-6,
            // The file claims SYSTEM. The importer must ignore it
            // and tag the inserted row as USER.
            source: 'SYSTEM',
          },
        ],
        'tester'
      );
      expect(result.created).toEqual(['anthropic/claude-haiku-4-5']);
      expect(result.updated).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.total).toBe(1);
      expect(ops).toHaveLength(1);
      expect(ops[0].kind).toBe('insert');
      expect(ops[0].values).toMatchObject({
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        inputCostPerToken: 1e-6,
        outputCostPerToken: 5e-6,
        cachedInputCostPerToken: 0,
        reasoningCostPerToken: 0,
        source: 'USER',
        createdBy: 'tester',
        updatedBy: 'tester',
      });
    });

    it('leaves identical SYSTEM rows untouched (source stays SYSTEM)', async () => {
      const { svc, ops } = buildImportSvc([baseRow]);
      const result = await svc.importMany(
        [
          {
            provider: baseRow.provider,
            model: baseRow.model,
            inputCostPerToken: baseRow.inputCostPerToken,
            outputCostPerToken: baseRow.outputCostPerToken,
            cachedInputCostPerToken: baseRow.cachedInputCostPerToken,
            reasoningCostPerToken: baseRow.reasoningCostPerToken,
          },
        ],
        'tester'
      );
      expect(result.unchanged).toEqual(['openai/gpt-4o-mini']);
      expect(result.updated).toEqual([]);
      expect(result.created).toEqual([]);
      // Critical: no DB write — `source` is preserved untouched.
      expect(ops).toEqual([]);
    });

    it('updates and promotes SYSTEM → USER when any cost field differs', async () => {
      const { svc, ops } = buildImportSvc([baseRow]);
      const result = await svc.importMany(
        [
          {
            provider: baseRow.provider,
            model: baseRow.model,
            inputCostPerToken: baseRow.inputCostPerToken,
            // One field bumped — must trigger update + promotion.
            outputCostPerToken: 0.0000007,
            cachedInputCostPerToken: baseRow.cachedInputCostPerToken,
            reasoningCostPerToken: baseRow.reasoningCostPerToken,
          },
        ],
        'tester'
      );
      expect(result.updated).toEqual(['openai/gpt-4o-mini']);
      expect(ops).toHaveLength(1);
      expect(ops[0].kind).toBe('update');
      expect(ops[0].set).toMatchObject({
        outputCostPerToken: 0.0000007,
        source: 'USER',
        updatedBy: 'tester',
      });
      expect(ops[0].where).toEqual({
        column: 'pricingId',
        op: '=',
        value: baseRow.pricingId,
      });
    });

    it('keeps USER rows as USER on update (no demotion)', async () => {
      const userRow = { ...baseRow, source: 'USER' as const };
      const { svc, ops } = buildImportSvc([userRow]);
      await svc.importMany(
        [
          {
            provider: userRow.provider,
            model: userRow.model,
            inputCostPerToken: 0.00000099,
            outputCostPerToken: userRow.outputCostPerToken,
            cachedInputCostPerToken: userRow.cachedInputCostPerToken,
            reasoningCostPerToken: userRow.reasoningCostPerToken,
          },
        ],
        'tester'
      );
      expect(ops[0].set).toMatchObject({ source: 'USER' });
    });

    it("treats near-identical floats (round-trip tolerance) as 'unchanged'", async () => {
      // A round-trip through `JSON.stringify` and back doesn't always
      // reproduce the exact same float. The importer uses a tiny
      // epsilon so an export → re-import doesn't spuriously promote
      // every SYSTEM row to USER.
      const { svc, ops } = buildImportSvc([baseRow]);
      const tinyDrift = baseRow.inputCostPerToken + 1e-20;
      const result = await svc.importMany(
        [
          {
            provider: baseRow.provider,
            model: baseRow.model,
            inputCostPerToken: tinyDrift,
            outputCostPerToken: baseRow.outputCostPerToken,
            cachedInputCostPerToken: baseRow.cachedInputCostPerToken,
            reasoningCostPerToken: baseRow.reasoningCostPerToken,
          },
        ],
        'tester'
      );
      expect(result.unchanged).toEqual(['openai/gpt-4o-mini']);
      expect(ops).toEqual([]);
    });

    it('accepts string-typed costs (parsed from CSV) and coerces them', async () => {
      const { svc, ops } = buildImportSvc([]);
      const result = await svc.importMany(
        [
          {
            provider: 'gemini',
            model: 'gemini-2.5-flash-lite',
            inputCostPerToken: '0.00000025',
            outputCostPerToken: '0.000001',
          },
        ],
        'tester'
      );
      expect(result.created).toEqual(['gemini/gemini-2.5-flash-lite']);
      expect(ops[0].values).toMatchObject({
        inputCostPerToken: 0.00000025,
        outputCostPerToken: 0.000001,
      });
    });

    /**
     * `throwServiceError` wraps the reason in a `ServiceError` inside
     * an `HttpException`. `HttpException.message` is the literal
     * 'Http Exception' string — the real validation reason lives on
     * `(err as HttpException).getResponse().errorMessage`. This helper
     * pulls that out so the negative-path tests can assert on the
     * actual error wording the API surfaces.
     */
    async function captureErrorMessage(p: Promise<unknown>): Promise<string> {
      try {
        await p;
      } catch (err) {
        if (err instanceof HttpException) {
          const resp = err.getResponse() as { errorMessage?: string };
          return resp.errorMessage ?? err.message;
        }
        if (err instanceof Error) return err.message;
        return String(err);
      }
      throw new Error('Expected promise to reject');
    }

    it('rejects in-file duplicate (provider, model)', async () => {
      const { svc } = buildImportSvc([]);
      const msg = await captureErrorMessage(
        svc.importMany(
          [
            {
              provider: 'openai',
              model: 'gpt-4o',
              inputCostPerToken: 1e-6,
              outputCostPerToken: 1e-6,
            },
            {
              provider: 'openai',
              model: 'gpt-4o',
              inputCostPerToken: 2e-6,
              outputCostPerToken: 2e-6,
            },
          ],
          'tester'
        )
      );
      expect(msg).toMatch(/Duplicate row/i);
    });

    it('rejects rows missing required cost fields', async () => {
      const { svc } = buildImportSvc([]);
      const msg = await captureErrorMessage(
        svc.importMany(
          [
            {
              provider: 'openai',
              model: 'gpt-4o',
              // outputCostPerToken intentionally missing
              inputCostPerToken: 1e-6,
            },
          ],
          'tester'
        )
      );
      expect(msg).toMatch(/outputCostPerToken/);
    });

    it('rejects negative cost values', async () => {
      const { svc } = buildImportSvc([]);
      const msg = await captureErrorMessage(
        svc.importMany(
          [
            {
              provider: 'openai',
              model: 'gpt-4o',
              inputCostPerToken: -1e-6,
              outputCostPerToken: 1e-6,
            },
          ],
          'tester'
        )
      );
      expect(msg).toMatch(/inputCostPerToken/);
    });

    it('rejects non-array payloads', async () => {
      const { svc } = buildImportSvc([]);
      const msg = await captureErrorMessage(
        svc.importMany({ provider: 'openai' } as unknown, 'tester')
      );
      expect(msg).toMatch(/array/i);
    });

    it('rejects empty payloads', async () => {
      const { svc } = buildImportSvc([]);
      const msg = await captureErrorMessage(svc.importMany([], 'tester'));
      expect(msg).toMatch(/empty/i);
    });
  });
});
