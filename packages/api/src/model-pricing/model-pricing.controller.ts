import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticatedUser } from '../auth/auth.guard';
import { UserEntity } from '../users/entities/user.entity';
import { ModelPricingService } from './model-pricing.service';
import { ModelPricingEntity } from './entities/model-pricing.entity';
import { CreateModelPricingDto } from './dto/create-model-pricing.dto';
import { UpdateModelPricingDto } from './dto/update-model-pricing.dto';
import { ImportModelPricingResultDto } from './dto/import-model-pricing.dto';
import { fromCsv, toCsv } from './csv-codec';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';

// Columns surfaced in the CSV export, in the order the file lays
// them out. `pricingId` / timestamps / audit columns are deliberately
// omitted — they're metadata, not part of the operator-facing pricing
// contract, and including them would make a re-import inadvertently
// carry over UUIDs from another environment. `source` IS included so
// an export round-trip preserves which rows are SYSTEM vs USER for
// operator visibility; the importer ignores it on the way back in.
const PRICING_CSV_COLUMNS = [
  'provider',
  'model',
  'inputCostPerToken',
  'outputCostPerToken',
  'cachedInputCostPerToken',
  'reasoningCostPerToken',
  'source',
] as const;

@ApiTags('Model Pricing')
@Controller('model-pricing')
export class ModelPricingController {
  constructor(private readonly service: ModelPricingService) {}

  @Get()
  @ApiOperation({ summary: 'List model pricing entries' })
  @ApiOkResponse({ type: [ModelPricingEntity] })
  @ApiQuery({
    name: 'provider',
    required: false,
    description: 'Optional provider filter (e.g. openai, anthropic).',
  })
  async list(@Query('provider') provider?: string) {
    return this.service.list(provider);
  }

  /**
   * Export the full pricing table as a downloadable file. Defaults to
   * JSON; pass `?format=csv` for a spreadsheet-friendly CSV. The
   * response carries a `Content-Disposition: attachment` header so
   * browsers trigger a download rather than rendering inline.
   *
   * Declared **before** the `:pricingId` route below — NestJS matches
   * routes in declaration order and `ParseUUIDPipe` on `:pricingId`
   * would reject the literal 'export' segment with a 400.
   */
  @Get('export')
  @ApiOperation({
    summary: 'Export the pricing table as a downloadable file',
    description:
      'Returns the full pricing table as `application/json` or `text/csv` based on `?format`. The `source` column is included so operators can see which rows are SYSTEM vs USER; on re-import the column is ignored — the importer always decides source itself.',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['json', 'csv'],
    description: 'Output format. Defaults to `json`.',
  })
  @ApiProduces('application/json', 'text/csv')
  async exportAll(
    @Query('format') format: 'json' | 'csv' = 'json',
    @Res({ passthrough: true }) res: FastifyReply
  ): Promise<string | ModelPricingEntity[]> {
    const rows = await this.service.list();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'csv') {
      const csvRows = rows.map((row) => ({
        provider: row.provider,
        model: row.model,
        inputCostPerToken: row.inputCostPerToken,
        outputCostPerToken: row.outputCostPerToken,
        cachedInputCostPerToken: row.cachedInputCostPerToken ?? 0,
        reasoningCostPerToken: row.reasoningCostPerToken ?? 0,
        source: row.source,
      }));
      const body = toCsv(csvRows, PRICING_CSV_COLUMNS);
      res.header('content-type', 'text/csv; charset=utf-8');
      res.header(
        'content-disposition',
        `attachment; filename="model-pricing-${stamp}.csv"`
      );
      return body;
    }
    res.header('content-type', 'application/json; charset=utf-8');
    res.header(
      'content-disposition',
      `attachment; filename="model-pricing-${stamp}.json"`
    );
    return rows;
  }

  @Get(':pricingId')
  @ApiOperation({ summary: 'Get a model pricing entry by id' })
  @ApiOkResponse({ type: ModelPricingEntity })
  async get(
    @Param('pricingId', new ParseUUIDPipe({ version: '4' })) pricingId: string
  ) {
    return this.service.getById(pricingId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a model pricing entry' })
  @ApiOkResponse({ type: ModelPricingEntity })
  async create(
    @Body() body: CreateModelPricingDto,
    @AuthenticatedUser() user: UserEntity
  ) {
    return this.service.create(body, user.id);
  }

  @Put(':pricingId')
  @ApiOperation({ summary: 'Update a model pricing entry' })
  @ApiOkResponse({ type: ModelPricingEntity })
  async update(
    @Param('pricingId', new ParseUUIDPipe({ version: '4' })) pricingId: string,
    @Body() body: UpdateModelPricingDto,
    @AuthenticatedUser() user: UserEntity
  ) {
    return this.service.update(pricingId, body, user.id);
  }

  @Delete(':pricingId')
  @ApiOperation({ summary: 'Delete a model pricing entry' })
  async delete(
    @Param('pricingId', new ParseUUIDPipe({ version: '4' })) pricingId: string
  ) {
    await this.service.delete(pricingId);
  }

  /**
   * Bulk-import pricing rows. Accepts either a JSON array body (with
   * `Content-Type: application/json`) or a CSV body (with
   * `Content-Type: text/csv`). The request's content-type drives the
   * parser; no `?format` query param is needed.
   *
   * Source-promotion rules (server-side):
   *   - New rows are inserted as `source = USER`. Any `source` value
   *     in the file is ignored — the importer always decides.
   *   - Existing rows whose costs match the file exactly are left
   *     untouched (a SYSTEM row stays SYSTEM so the pricing sync
   *     continues to manage it).
   *   - Existing rows whose costs differ are updated and promoted to
   *     `source = USER`, so the next sync run won't revert the edit.
   */
  @Post('import')
  @ApiOperation({
    summary: 'Bulk-import pricing rows from a CSV or JSON file',
    description:
      'Drives source promotion automatically: new rows → USER, identical rows → unchanged (source preserved, so SYSTEM rows stay SYSTEM), differing rows → updated + promoted to USER. Any `source` column in the file is ignored.',
  })
  @ApiConsumes('application/json', 'text/csv')
  @ApiBody({
    description:
      'JSON array of pricing rows, or a CSV body with a header row matching `provider,model,inputCostPerToken,outputCostPerToken,cachedInputCostPerToken,reasoningCostPerToken` (the `source` column is accepted but ignored).',
    schema: {
      oneOf: [
        {
          type: 'array',
          items: { $ref: '#/components/schemas/CreateModelPricingDto' },
        },
        { type: 'string', description: 'CSV body' },
      ],
    },
  })
  @ApiOkResponse({ type: ImportModelPricingResultDto })
  async import(
    @Req() req: FastifyRequest,
    @AuthenticatedUser() user: UserEntity
  ): Promise<ImportModelPricingResultDto> {
    const contentType = (req.headers['content-type'] ?? '')
      .toString()
      .toLowerCase();
    let records: unknown;
    if (
      contentType.includes('text/csv') ||
      contentType.includes('text/plain')
    ) {
      if (typeof req.body !== 'string' || req.body.length === 0) {
        throwServiceError(
          HttpStatus.BAD_REQUEST,
          ErrorCode.GENERIC_VALIDATION,
          { reason: 'CSV import body must be a non-empty string.' }
        );
      }
      try {
        records = fromCsv(req.body as string);
      } catch (err) {
        throwServiceError(
          HttpStatus.BAD_REQUEST,
          ErrorCode.GENERIC_VALIDATION,
          {
            reason: `Failed to parse CSV: ${(err as Error).message}`,
          }
        );
      }
    } else {
      // application/json (or unspecified) — Fastify already parsed.
      records = req.body;
    }
    return this.service.importMany(records, user.id);
  }
}
