import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsUrl,
} from 'class-validator';
import { $enum } from 'ts-enum-util';

export enum CompletionBatchCallbackEvent {
  BATCH_UPDATE = 'batch_update',
  ITEM_UPDATE = 'item_update',
  ALL = 'all',
}

export const CompletionBatchCallbackEventValues = $enum(
  CompletionBatchCallbackEvent
).getValues();

export class CompletionBatchCallbackOptionsDto {
  @ApiProperty({
    description: 'The URL to send the callback to',
    example: 'https://example.com/callback',
  })
  @IsNotEmpty()
  @IsUrl()
  url: string;

  @ApiProperty({
    description: 'The headers to send with the callback',
    example: {
      'Content-Type': 'application/json',
    },
    nullable: true,
    required: false,
    type: Object,
    additionalProperties: {
      type: 'string',
    },
  })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string> | null;

  @ApiProperty({
    description: 'The events to send the callback for',
    example: [CompletionBatchCallbackEvent.ALL],
    enumName: 'CompletionBatchCallbackEvent',
    enum: CompletionBatchCallbackEventValues,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(CompletionBatchCallbackEventValues)
  events: CompletionBatchCallbackEvent[];
}
