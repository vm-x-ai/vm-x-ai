import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../storage/database.service';
import { CompletionBatchEntity } from './entity/batch.entity';
import { UpdateCompletionBatchCountersDto } from './dto/update-batch-counter.dto';
import { Expression, RawBuilder, sql } from 'kysely';
import {
  DB,
  PublicCompletionBatchRequestStatus,
  PublicCompletionBatchRequestType,
} from '../../storage/entities.generated';
import { UpdateCompletionBatchDto } from './dto/update-batch.dto';
import {
  CompletionBatchCallbackEvent,
  CompletionBatchCallbackOptionsDto,
} from './dto/callback-options.dto';
import { throwServiceError } from '../../error';
import { ErrorCode } from '../../error-code';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { CompletionBatchDto } from './dto/batch.dto';
import { GetBatchDto } from './dto/get-batch.dto';
import {
  CreateCompletionBatchDto,
  CreateCompletionCallbackBatchDto,
} from './dto/create-batch.dto';
import { CompletionBatchItemService } from './batch-item-service';
import { AuthContext } from '../../auth/auth.guard';
import { v4 as uuidv4 } from 'uuid';
import { TokenService } from '../../token/token.service';
import { CreateCompletionBatchItemWithEstimatedPromptTokensDto } from './dto/create-batch-item.dto';
import { CompletionBatchQueueService } from './batch-queue.service';

@Injectable()
export class CompletionBatchService {
  constructor(
    private readonly db: DatabaseService,
    private readonly completionBatchItemService: CompletionBatchItemService,
    private readonly completionBatchQueueService: CompletionBatchQueueService,
    private readonly tokenService: TokenService
  ) {}

  public async getById(payload: GetBatchDto): Promise<CompletionBatchDto>;

  public async getById<T extends false>(
    payload: GetBatchDto,
    throwOnNotFound: T
  ): Promise<CompletionBatchDto | undefined>;

  public async getById<T extends true>(
    payload: GetBatchDto,
    throwOnNotFound: T
  ): Promise<CompletionBatchDto>;

  public async getById(
    {
      workspaceId,
      environmentId,
      batchId,
      includesUsers,
      includesItems,
    }: GetBatchDto,
    throwOnNotFound = true
  ): Promise<CompletionBatchDto | undefined> {
    const batch = this.db.reader
      .selectFrom('completionBatch')
      .selectAll('completionBatch')
      .select(
        sql<number>`(completed + failed + running + pending) / totalItems * 100`.as(
          'completedPercentage'
        )
      )
      .$if(!!includesUsers, (qb) =>
        qb.select((eb) => [
          eb
            .case()
            .when('completionBatch.createdByUserId', '=', null)
            .then(null)
            .else(
              this.db
                .withUser(
                  eb.ref(`completionBatch.createdByUserId`),
                  'createdByUserId'
                )
                .$notNull()
            )
            .end()
            .as('createdByUser'),
          eb
            .case()
            .when('completionBatch.createdByApiKeyId', '=', null)
            .then(null)
            .else(
              this.db.withApiKey(
                eb.ref(`completionBatch.workspaceId`),
                eb.ref(`completionBatch.environmentId`),
                eb.ref(`completionBatch.createdByApiKeyId`),
                'createdByApiKey'
              )
            )
            .end()
            .as('createdByApiKey'),
        ])
      )
      .$if(!!includesItems, (qb) =>
        qb.select((eb) => [
          this.withItems(
            eb.ref(`completionBatch.workspaceId`),
            eb.ref(`completionBatch.environmentId`),
            eb.ref(`completionBatch.batchId`)
          ).as('items'),
        ])
      )
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('batchId', '=', batchId)
      .executeTakeFirst();

    if (throwOnNotFound && !batch) {
      throwServiceError(
        HttpStatus.NOT_FOUND,
        ErrorCode.COMPLETION_BATCH_NOT_FOUND,
        {
          batchId,
        }
      );
    }

    return batch;
  }

  public async update(
    workspaceId: string,
    environmentId: string,
    batchId: string,
    payload: UpdateCompletionBatchDto
  ): Promise<CompletionBatchEntity> {
    return await this.db.writer
      .updateTable('completionBatch')
      .set({
        ...payload,
      })
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('batchId', '=', batchId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async incrementCounters(
    workspaceId: string,
    environmentId: string,
    batchId: string,
    payload: UpdateCompletionBatchCountersDto
  ): Promise<CompletionBatchEntity> {
    return await this.db.writer
      .updateTable('completionBatch')
      .set(
        (eb) =>
          Object.entries(payload).reduce((acc, [key, value]) => {
            const column = key as keyof DB['completionBatch'];
            acc[column] = sql`${sql.ref(column)} + ${eb.lit(value ?? 0)}`;
            return acc;
          }, {} as Record<keyof DB['completionBatch'], RawBuilder<number>>) as never
      )
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('batchId', '=', batchId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async create(
    workspaceId: string,
    environmentId: string,
    payload: CreateCompletionBatchDto | CreateCompletionCallbackBatchDto,
    authContext: AuthContext
  ): Promise<CompletionBatchDto> {
    const batch = await this.db.writer.transaction().execute(async (tx) => {
      const { items, ...rest } = payload;
      const batchId = uuidv4();
      let totalEstimatedPromptTokens = 0;
      const itemPayloads: CreateCompletionBatchItemWithEstimatedPromptTokensDto[] =
        [];
      for (const item of items) {
        const itemEstimatedPromptTokens = this.tokenService.getRequestTokens(
          item.request
        );
        totalEstimatedPromptTokens += itemEstimatedPromptTokens;
        itemPayloads.push({
          ...item,
          estimatedPromptTokens: itemEstimatedPromptTokens,
        });
      }

      const batch = await tx
        .insertInto('completionBatch')
        .values({
          ...rest,
          workspaceId,
          environmentId,
          batchId,
          status: PublicCompletionBatchRequestStatus.PENDING,
          timestamp: new Date(),
          capacity: payload.capacity ? JSON.stringify(payload.capacity) : null,
          callbackOptions:
            payload.type === PublicCompletionBatchRequestType.CALLBACK
              ? JSON.stringify(payload.callbackOptions)
              : null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdByApiKeyId: authContext.apiKey?.apiKeyId ?? null,
          createdByUserId: authContext.user?.id ?? null,
          totalEstimatedPromptTokens,
          totalItems: itemPayloads.length,
          pending: itemPayloads.length,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const batchItems = await this.completionBatchItemService.createMany(
        workspaceId,
        environmentId,
        batchId,
        itemPayloads,
        tx
      );

      return {
        ...batch,
        items: batchItems,
        completedPercentage: 0,
      };
    });

    await this.completionBatchQueueService.sendBatch(batch, batch.items);
    return batch;
  }

  public async cancel(
    workspaceId: string,
    environmentId: string,
    batchId: string
  ): Promise<void> {
    await this.db.writer.transaction().execute(async (tx) => {
      await tx
        .updateTable('completionBatch')
        .set({
          status: PublicCompletionBatchRequestStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage: 'Batch cancelled by user',
        })
        .where('workspaceId', '=', workspaceId)
        .where('environmentId', '=', environmentId)
        .where('batchId', '=', batchId)
        .execute();

      await tx
        .updateTable('completionBatchItems')
        .set({
          status: PublicCompletionBatchRequestStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage: 'Batch cancelled by user',
        })
        .where('workspaceId', '=', workspaceId)
        .where('environmentId', '=', environmentId)
        .where('batchId', '=', batchId)
        .where('status', '=', PublicCompletionBatchRequestStatus.PENDING)
        .execute();
    });
  }

  public matchCallbackEvent(
    event: CompletionBatchCallbackEvent,
    callbackOptions?: CompletionBatchCallbackOptionsDto | null
  ): boolean {
    if (callbackOptions?.events.includes(CompletionBatchCallbackEvent.ALL)) {
      return true;
    }

    return callbackOptions?.events.includes(event) ?? false;
  }

  private withItems(
    workspaceId: Expression<string>,
    environmentId: Expression<string>,
    batchId: Expression<string>
  ) {
    return jsonArrayFrom(
      this.db.reader
        .selectFrom('completionBatchItems')
        .selectAll('completionBatchItems')
        .where('workspaceId', '=', workspaceId)
        .where('environmentId', '=', environmentId)
        .where('batchId', '=', batchId)
    );
  }
}
