import { ApiProperty } from '@nestjs/swagger';
import { PublicCompletionAuditType } from '../../../storage/entities.generated';
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
  CompletionAuditEntity,
  completionAuditTypes,
} from '../entities/audit.entity';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/pagination.dto';

export class ListAuditQueryDto {
  @ApiProperty({
    name: 'type',
    enumName: 'CompletionAuditType',
    enum: completionAuditTypes,
    description: 'The type of audit to list',
    example: PublicCompletionAuditType.COMPLETION,
    nullable: true,
    required: false,
  })
  @IsEnum(PublicCompletionAuditType)
  @IsOptional()
  type?: PublicCompletionAuditType | null;

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
    description: 'The resource to list audits for',
    example: 'resource-identifier',
    nullable: true,
  })
  @IsString()
  @IsOptional()
  resource?: string | null;

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
}

export class ListAuditResponseDto extends PaginationDto<CompletionAuditEntity> {
  @ApiProperty({
    description: 'The data',
    type: CompletionAuditEntity,
    isArray: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompletionAuditEntity)
  override data: CompletionAuditEntity[];
}
