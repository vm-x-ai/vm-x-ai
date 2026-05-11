import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { sql } from 'kysely';
import { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RedisClient } from '../cache/redis-client';
import { DatabaseService } from '../storage/database.service';
import { PublicModelPricingSource } from '../storage/entities.generated';
import { ModelPricingService } from './model-pricing.service';

const LOCK_KEY = 'pricing-sync:lock';
const LOCK_TTL_SECONDS = 300;
const FETCH_TIMEOUT_MS = 15_000;
const CRON_JOB_NAME = 'pricing-sync';

// `@Cron` evaluates its argument at class-definition time, before the
// Nest container instantiates ConfigService. Reading the env directly
// here is the documented workaround for env-driven schedules
// (https://docs.nestjs.com/techniques/task-scheduling). The schema in
// config/schema.ts still validates this var on boot.
const CRON_EXPRESSION = process.env.PRICING_SYNC_CRON || '0 3 * * *';

// Lua: only delete the lock if its value still matches the token we
// wrote. Without this guard, a slow sync that overruns the TTL could
// delete a successor instance's lock.
const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

type PricingSnapshotRow = {
  provider: string;
  model: string;
  inputCostPerToken: number;
  outputCostPerToken: number;
  cachedInputCostPerToken: number;
  reasoningCostPerToken: number;
};

type PricingSnapshot = {
  version: string;
  models: PricingSnapshotRow[];
};

@Injectable()
export class PricingSyncService implements OnModuleInit {
  private readonly enabled: boolean;
  private readonly url: string;
  private readonly fallback: PricingSnapshot;

  constructor(
    private readonly logger: PinoLogger,
    configService: ConfigService,
    private readonly redisClient: RedisClient,
    private readonly db: DatabaseService,
    private readonly pricingService: ModelPricingService,
    private readonly scheduler: SchedulerRegistry
  ) {
    this.logger.setContext(PricingSyncService.name);
    this.enabled = configService.get<boolean>('PRICING_SYNC_ENABLED') ?? true;
    this.url = configService.getOrThrow<string>('PRICING_SYNC_URL');
    // Bundled fallback is loaded once at construction. Path is
    // resolved relative to the compiled file: in dev (vitest reads
    // .ts) this lands at packages/api/src/data/, and in prod (SWC
    // build) the file is copied via nest-cli.json `assets` to
    // dist/src/data/.
    const fallbackPath = join(__dirname, '..', 'data', 'pricing-fallback.json');
    this.fallback = JSON.parse(
      readFileSync(fallbackPath, 'utf8')
    ) as PricingSnapshot;
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.info(
        'pricing sync disabled (PRICING_SYNC_ENABLED=false) — unregistering cron'
      );
      // The decorator already registered the job; tear it down so it
      // never fires.
      if (this.scheduler.doesExist('cron', CRON_JOB_NAME)) {
        this.scheduler.deleteCronJob(CRON_JOB_NAME);
      }
      return;
    }
    // Fire once on boot so fresh installs see pricing immediately.
    // Don't await — boot must not block on the network.
    void this.runWithLock();
  }

  @Cron(CRON_EXPRESSION, { name: CRON_JOB_NAME })
  async runScheduledSync(): Promise<void> {
    await this.runWithLock();
  }

  private async runWithLock(): Promise<void> {
    const token = randomUUID();
    // ioredis SET with NX + EX: only sets if key absent, with a TTL so
    // a crashed holder can't deadlock the lock forever.
    const acquired = await this.redisClient.client.set(
      LOCK_KEY,
      token,
      'EX',
      LOCK_TTL_SECONDS,
      'NX'
    );
    if (acquired !== 'OK') {
      this.logger.debug(
        'pricing sync skipped — another instance holds the lock'
      );
      return;
    }
    try {
      await this.runSync();
    } catch (err) {
      this.logger.error({ err }, 'pricing sync failed');
    } finally {
      try {
        await this.redisClient.client.eval(RELEASE_LUA, 1, LOCK_KEY, token);
      } catch (err) {
        this.logger.warn(
          { err },
          'failed to release pricing sync lock — TTL will expire it'
        );
      }
    }
  }

  private async runSync(): Promise<void> {
    const snapshot = await this.fetchSnapshot();
    this.logger.info(
      { version: snapshot.version, count: snapshot.models.length },
      'applying pricing snapshot'
    );

    const rows = snapshot.models.map((m) => ({
      provider: m.provider,
      model: m.model,
      inputCostPerToken: m.inputCostPerToken,
      outputCostPerToken: m.outputCostPerToken,
      cachedInputCostPerToken: m.cachedInputCostPerToken,
      reasoningCostPerToken: m.reasoningCostPerToken,
      source: PublicModelPricingSource.SYSTEM,
      createdBy: 'pricing-sync',
      updatedBy: 'pricing-sync',
    }));

    // Single multi-row upsert. The WHERE on the conflict update guards
    // 'USER' overrides — the conflict target row is left untouched if
    // an operator has previously edited it via the Pricing UI.
    await this.db.writer
      .insertInto('modelPricing')
      .values(rows)
      .onConflict((oc) =>
        oc
          .columns(['provider', 'model'])
          .doUpdateSet({
            inputCostPerToken: (eb) => eb.ref('excluded.inputCostPerToken'),
            outputCostPerToken: (eb) => eb.ref('excluded.outputCostPerToken'),
            cachedInputCostPerToken: (eb) =>
              eb.ref('excluded.cachedInputCostPerToken'),
            reasoningCostPerToken: (eb) =>
              eb.ref('excluded.reasoningCostPerToken'),
            updatedAt: sql`CURRENT_TIMESTAMP`,
            updatedBy: 'pricing-sync',
          })
          .where('modelPricing.source', '=', PublicModelPricingSource.SYSTEM)
      )
      .execute();

    // Wipe the per-(provider, model) cache so cost calc picks up the
    // new prices on the next request.
    this.pricingService.invalidateAll();
  }

  private async fetchSnapshot(): Promise<PricingSnapshot> {
    try {
      const response = await fetch(this.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${this.url}`);
      }
      const json = (await response.json()) as unknown;
      this.assertValidSnapshot(json);
      return json;
    } catch (err) {
      this.logger.warn(
        { err, url: this.url, fallbackVersion: this.fallback.version },
        'failed to fetch remote pricing snapshot — using bundled fallback'
      );
      return this.fallback;
    }
  }

  private assertValidSnapshot(
    value: unknown
  ): asserts value is PricingSnapshot {
    if (!value || typeof value !== 'object') {
      throw new Error('snapshot is not an object');
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.version !== 'string') {
      throw new Error('snapshot.version missing');
    }
    if (!Array.isArray(obj.models)) {
      throw new Error('snapshot.models missing');
    }
    for (const m of obj.models) {
      if (!m || typeof m !== 'object') {
        throw new Error('snapshot.models contains non-object entry');
      }
      const r = m as Record<string, unknown>;
      if (typeof r.provider !== 'string' || typeof r.model !== 'string') {
        throw new Error('snapshot row missing provider/model');
      }
      if (
        typeof r.inputCostPerToken !== 'number' ||
        typeof r.outputCostPerToken !== 'number'
      ) {
        throw new Error(
          `snapshot row missing token cost: ${r.provider}/${r.model}`
        );
      }
    }
  }
}
