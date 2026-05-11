import { ApiProperty } from '@nestjs/swagger';
import { PublicRequestAuditType } from '../../storage/entities.generated';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  RequestAuditEntity,
  requestAuditTypes,
} from '../entities/audit.entity';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/pagination.dto';

export class ListAuditQueryDto {
  @ApiProperty({
    name: 'type',
    enumName: 'RequestAuditType',
    enum: requestAuditTypes,
    description: 'The type of audit to list',
    example: PublicRequestAuditType.COMPLETION,
    nullable: true,
    required: false,
  })
  @IsEnum(PublicRequestAuditType)
  @IsOptional()
  type?: PublicRequestAuditType | null;

  @ApiProperty({
    type: 'string',
    required: false,
    description: 'The connection ID to list audits for',
    example: 'connection-identifier',
    format: 'uuid',
    nullable: true,
  })
  @IsUUID('4')
  @IsOptional()
  connectionId?: string | null;

  @ApiProperty({
    type: 'string',
    required: false,
    description:
      'Filter by the gateway-assigned request id (the value the gateway returns on the `x-vmx-request-id` response header). Used by the playground to deep-link a chat reply to its audit row.',
    example: 'b1f2e9c0-...-7e3c5d',
    nullable: true,
  })
  @IsString()
  @IsOptional()
  requestId?: string | null;

  @ApiProperty({
    type: 'string',
    required: false,
    description: 'The resource to list audits for',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
    nullable: true,
  })
  @IsUUID('4')
  @IsOptional()
  resourceId?: string | null;

  @ApiProperty({
    type: 'string',
    required: false,
    description: 'The model to list audits for',
    example: 'gpt-4o',
    nullable: true,
  })
  @IsString()
  @IsOptional()
  model?: string | null;

  @ApiProperty({
    type: 'number',
    required: false,
    description: 'The status code to list audits for',
    example: 200,
    nullable: true,
  })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  statusCode?: number | null;

  @ApiProperty({
    type: 'string',
    required: false,
    format: 'date-time',
    description: 'The start date to list audits for',
    example: '2021-01-01',
    nullable: true,
  })
  @IsDateString()
  @IsOptional()
  startDate?: Date | null;

  @ApiProperty({
    type: 'string',
    required: false,
    format: 'date-time',
    description: 'The end date to list audits for',
    example: '2021-01-01',
    nullable: true,
  })
  @IsDateString()
  @IsOptional()
  endDate?: Date | null;

  @ApiProperty({
    type: 'integer',
    required: false,
    description: 'The page number to list audits for',
    example: 0,
    nullable: true,
  })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  pageIndex?: number | null;

  @ApiProperty({
    type: 'integer',
    required: false,
    description: 'The page size to list audits for',
    example: 10,
    nullable: true,
  })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  pageSize?: number | null;

  @ApiProperty({
    type: 'string',
    required: false,
    description:
      'Metadata key to filter on (must be set together with metadataValue). Filters rows where vmx.metadata[key] = metadataValue. Single-pair convenience for the legacy URL shape — for multi-pair AND filters, use metadataFilters.',
    example: 'tenant_id',
    nullable: true,
  })
  @IsString()
  @IsOptional()
  metadataKey?: string | null;

  @ApiProperty({
    type: 'string',
    required: false,
    description: 'Metadata value to filter on (paired with metadataKey).',
    example: 'tenant-abc-123',
    nullable: true,
  })
  @IsString()
  @IsOptional()
  metadataValue?: string | null;

  @ApiProperty({
    type: 'string',
    required: false,
    description:
      'JSON object of metadata key/value pairs to AND together. Each entry filters rows where vmx.metadata[key] = value. Encoded as a JSON string when sent as a query param, e.g. metadataFilters={"team":"growth","env":"prod"}. Combined with the singular metadataKey/metadataValue if both are set.',
    example: '{"tenant_id":"tenant-abc-123","env":"prod"}',
    nullable: true,
  })
  @IsString()
  @IsOptional()
  metadataFilters?: string | null;

  @ApiProperty({
    type: 'string',
    required: false,
    description:
      'Field to group rows by client-side. Either "correlationId" or a metadata key prefixed with "metadata.", e.g. "metadata.tenant_id".',
    example: 'correlationId',
    nullable: true,
  })
  @IsString()
  @IsOptional()
  groupBy?: string | null;
}

export class ListAuditResponseDto extends PaginationDto<RequestAuditEntity> {
  @ApiProperty({
    description: 'The data',
    type: RequestAuditEntity,
    isArray: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequestAuditEntity)
  override data: RequestAuditEntity[];
}
