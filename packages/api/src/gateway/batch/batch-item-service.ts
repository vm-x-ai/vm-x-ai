import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../storage/database.service';
import { UpdateCompletionBatchItemDto } from './dto/update-batch-item.dto';
import { CompletionBatchItemEntity } from './entity/batch-item.entity';
import { GetBatchItemDto } from './dto/get-batch-item.dto';
import { throwServiceError } from '../../error';
import { ErrorCode } from '../../error-code';
import {
  CreateCompletionBatchItemDto,
  CreateCompletionBatchItemWithEstimatedPromptTokensDto,
} from './dto/create-batch-item.dto';
import { TokenService } from '../../token/token.service';
import {
  DB,
  PublicCompletionBatchRequestStatus,
} from '../../storage/entities.generated';
import { chunks } from '../../utils/chunk';
import { Transaction } from 'kysely';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class CompletionBatchItemService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly db: DatabaseService,
    private readonly tokenService: TokenService
  ) {}

  public async getById(
    payload: GetBatchItemDto
  ): Promise<CompletionBatchItemEntity>;

  public async getById<T extends false>(
    payload: GetBatchItemDto,
    throwOnNotFound: T
  ): Promise<CompletionBatchItemEntity | undefined>;

  public async getById<T extends true>(
    payload: GetBatchItemDto,
    throwOnNotFound: T
  ): Promise<CompletionBatchItemEntity>;

  public async getById(
    payload: GetBatchItemDto,
    throwOnNotFound: boolean
  ): Promise<CompletionBatchItemEntity | undefined>;

  public async getById(
    { workspaceId, environmentId, batchId, itemId }: GetBatchItemDto,
    throwOnNotFound = true
  ): Promise<CompletionBatchItemEntity | undefined> {
    const item = await this.db.reader
      .selectFrom('completionBatchItems')
      .selectAll('completionBatchItems')
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('batchId', '=', batchId)
      .where('itemId', '=', itemId)
      .executeTakeFirst();

    if (throwOnNotFound && !item) {
      throwServiceError(
        HttpStatus.NOT_FOUND,
        ErrorCode.COMPLETION_BATCH_ITEM_NOT_FOUND,
        {
          itemId,
        }
      );
    }

    return item ? (item as CompletionBatchItemEntity) : undefined;
  }

  public async createMany(
    workspaceId: string,
    environmentId: string,
    batchId: string,
    items: (
      | CreateCompletionBatchItemDto
      | CreateCompletionBatchItemWithEstimatedPromptTokensDto
    )[],
    tx?: Transaction<DB>
  ): Promise<CompletionBatchItemEntity[]> {
    return tx
      ? await this.createManyInternal(
          workspaceId,
          environmentId,
          batchId,
          items,
          tx
        )
      : await this.db.writer
          .transaction()
          .execute(
            async (tx) =>
              await this.createManyInternal(
                workspaceId,
                environmentId,
                batchId,
                items,
                tx
              )
          );
  }

  private async createManyInternal(
    workspaceId: string,
    environmentId: string,
    batchId: string,
    items: (
      | CreateCompletionBatchItemDto
      | CreateCompletionBatchItemWithEstimatedPromptTokensDto
    )[],
    tx: Transaction<DB>
  ): Promise<CompletionBatchItemEntity[]> {
    const startTime = Date.now();
    this.logger.info(
      {
        workspaceId,
        environmentId,
        batchId,
        items: items.length,
      },
      'Creating completion batch items'
    );
    const results: CompletionBatchItemEntity[] = [];
    for (const chunk of chunks(items, 100)) {
      this.logger.info(
        {
          workspaceId,
          environmentId,
          batchId,
          chunk: chunk.length,
        },
        'Creating completion batch items chunk'
      );
      const inserted = await tx
        .insertInto('completionBatchItems')
        .values(
          chunk.map((item) => ({
            ...item,
            workspaceId,
            environmentId,
            batchId,
            status: PublicCompletionBatchRequestStatus.PENDING,
            estimatedPromptTokens:
              'estimatedPromptTokens' in item
                ? item.estimatedPromptTokens
                : this.tokenService.getRequestTokensFromChatCompletions(
                    item.request
                  ),
            request: JSON.stringify(item.request),
            createdAt: new Date(),
          }))
        )
        .returningAll()
        .execute();
      for (const row of inserted) {
        results.push(row as CompletionBatchItemEntity);
      }
      this.logger.info(
        {
          workspaceId,
          environmentId,
          batchId,
          chunk: chunk.length,
        },
        'Completion batch items created successfully'
      );
    }

    const duration = Date.now() - startTime;
    this.logger.info(
      {
        workspaceId,
        environmentId,
        batchId,
        totalItems: results.length,
        duration,
      },
      'Completion batch items created successfully'
    );

    return results;
  }

  public async update(
    workspaceId: string,
    environmentId: string,
    batchId: string,
    itemId: string,
    payload: UpdateCompletionBatchItemDto
  ): Promise<CompletionBatchItemEntity> {
    const row = await this.db.writer
      .updateTable('completionBatchItems')
      .set({
        ...payload,
        response: payload.response
          ? JSON.stringify(payload.response)
          : undefined,
      })
      .where('workspaceId', '=', workspaceId)
      .where('environmentId', '=', environmentId)
      .where('batchId', '=', batchId)
      .where('itemId', '=', itemId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as CompletionBatchItemEntity;
  }
}
