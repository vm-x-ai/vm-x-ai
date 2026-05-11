import { ApiProperty } from '@nestjs/swagger';
import { PublicCompletionBatchRequestType } from '../../../storage/entities.generated';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { CompletionBatchCallbackOptionsDto } from './callback-options.dto';
import { Type } from 'class-transformer';
import { CapacityEntity } from '../../../capacity/capacity.entity';
import { CreateCompletionBatchItemDto } from './create-batch-item.dto';

export class CreateCompletionBaseBatchDto {
  @ApiProperty({
    description: 'The capacities of the batch request',
    type: [CapacityEntity],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CapacityEntity)
  @IsOptional()
  capacity?: CapacityEntity[] | null;

  @ApiProperty({
    description: 'The items to create in the batch',
    type: [CreateCompletionBatchItemDto],
  })
  @ArrayMinSize(1)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCompletionBatchItemDto)
  items: CreateCompletionBatchItemDto[];
}

export class CreateCompletionBatchDto extends CreateCompletionBaseBatchDto {
  @ApiProperty({
    description: 'The type of the batch request',
    enumName: 'CompletionBatchRequestType',
    enum: [
      PublicCompletionBatchRequestType.SYNC,
      PublicCompletionBatchRequestType.ASYNC,
    ],
    example: PublicCompletionBatchRequestType.ASYNC,
  })
  @IsEnum([
    PublicCompletionBatchRequestType.SYNC,
    PublicCompletionBatchRequestType.ASYNC,
  ])
  @IsNotEmpty()
  type:
    | PublicCompletionBatchRequestType.SYNC
    | PublicCompletionBatchRequestType.ASYNC;
}

export class CreateCompletionCallbackBatchDto extends CreateCompletionBaseBatchDto {
  @ApiProperty({
    description: 'The type of the batch request',
    enumName: 'CompletionBatchRequestType',
    enum: [PublicCompletionBatchRequestType.CALLBACK],
    example: PublicCompletionBatchRequestType.CALLBACK,
  })
  @IsEnum([PublicCompletionBatchRequestType.CALLBACK])
  @IsNotEmpty()
  type: PublicCompletionBatchRequestType.CALLBACK;

  @ApiProperty({
    description: 'The callback options for the batch request',
    type: CompletionBatchCallbackOptionsDto,
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CompletionBatchCallbackOptionsDto)
  callbackOptions: CompletionBatchCallbackOptionsDto;
}
