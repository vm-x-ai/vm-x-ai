import { $enum } from 'ts-enum-util';
import { AIResourceModelConfigEntity } from './model.entity';
import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  IsArray,
} from 'class-validator';

export enum RoutingAction {
  BLOCK = 'BLOCK',
  CALL_MODEL = 'CALL_MODEL',
}

export const routingActions = $enum(RoutingAction).getValues();

export enum RoutingOperator {
  AND = 'AND',
  OR = 'OR',
}

export const routingOperators = $enum(RoutingOperator).getValues();

export enum RoutingComparator {
  EQUAL = 'EQUAL',
  NOT_EQUAL = 'NOT_EQUAL',
  GREATER_THAN = 'GREATER_THAN',
  GREATER_THAN_OR_EQUAL = 'GREATER_THAN_OR_EQUAL',
  LESS_THAN = 'LESS_THAN',
  LESS_THAN_OR_EQUAL = 'LESS_THAN_OR_EQUAL',
  CONTAINS = 'CONTAINS',
  NOT_CONTAINS = 'NOT_CONTAINS',
  STARTS_WITH = 'STARTS_WITH',
  ENDS_WITH = 'ENDS_WITH',
  PATTERN = 'PATTERN',
  IN = 'IN',
  NOT_IN = 'NOT_IN',
  EXISTS = 'EXISTS',
}

export const routingComparators = $enum(RoutingComparator).getValues();

export enum RoutingConditionType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  COMMA_DELIMITED_LIST = 'comma-delimited-list',
  JSON_OBJECT = 'json-object',
  JSON_ARRAY = 'json-array',
}

export const routingConditionTypes = $enum(RoutingConditionType).getValues();

export enum RoutingMode {
  UI = 'UI',
  ADVANCED = 'ADVANCED',
}

export const routingModes = $enum(RoutingMode).getValues();

export class AIResourceRoutingConditionValue {
  @ApiProperty({
    enumName: 'RoutingConditionType',
    enum: routingConditionTypes,
    description: 'The type of the routing condition value',
    example: RoutingConditionType.STRING,
  })
  @IsEnum(RoutingConditionType)
  type: RoutingConditionType;

  @ApiPropertyOptional({
    description: 'An optional expression EJS for the condition value',
    example: '<%= request.tokens > 1000 %>',
  })
  @IsString()
  @IsOptional()
  expression?: string;
}

export enum RoutingItemType {
  CONDITION = 'condition',
  GROUP = 'group',
}

export class AIResourceRoutingCondition {
  @ApiProperty({
    description: 'The type of the routing condition',
    example: RoutingItemType.CONDITION,
    enum: [RoutingItemType.CONDITION],
  })
  @IsEnum([RoutingItemType.CONDITION])
  type: RoutingItemType.CONDITION = RoutingItemType.CONDITION;

  @ApiProperty({
    description: 'The unique ID of the routing condition',
    example: 'condition-id-string',
  })
  @IsString()
  id: string;

  @ApiProperty({
    description: 'Label for the routing condition',
    example: 'Request tokens are greater than 1000',
  })
  @IsString()
  label: string;

  @ApiProperty({
    description: 'The EJS expression to evaluate for the condition',
    example: '<%= request.tokens > 1000 %>',
  })
  @IsString()
  expression: string;

  @ApiProperty({
    enumName: 'RoutingComparator',
    enum: routingComparators,
    description: 'Comparator for the routing condition',
    example: RoutingComparator.EQUAL,
  })
  @IsEnum(RoutingComparator)
  comparator: RoutingComparator;

  @ApiProperty({
    type: AIResourceRoutingConditionValue,
    description: 'Value for the routing condition',
  })
  @ValidateNested()
  @Type(() => AIResourceRoutingConditionValue)
  value: AIResourceRoutingConditionValue;
}

export class AIResourceRoutingModelConfig extends AIResourceModelConfigEntity {
  @ApiPropertyOptional({
    description:
      'Traffic percentage sent to this model config, empty means all traffic',
    example: 60,
  })
  @IsNumber()
  @IsOptional()
  traffic?: number;
}

export class AIRoutingConditionGroup {
  @ApiProperty({
    description: 'The type of the routing condition',
    example: RoutingItemType.GROUP,
    enum: [RoutingItemType.GROUP],
  })
  @IsEnum([RoutingItemType.GROUP])
  type: RoutingItemType.GROUP = RoutingItemType.GROUP;

  @ApiPropertyOptional({
    description: 'Optional ID for the condition group',
    example: 'group-id-string',
  })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiPropertyOptional({
    description: 'Description of the condition group',
    example: 'Route #1',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    enumName: 'RoutingOperator',
    enum: routingOperators,
    description: 'Logical operator for grouping conditions',
    example: RoutingOperator.AND,
  })
  @IsEnum(RoutingOperator)
  operator: RoutingOperator;

  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(AIResourceRoutingCondition) },
        { $ref: getSchemaPath(AIRoutingConditionGroup) },
      ],
    },
    description: 'List of routing conditions',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: AIRoutingConditionGroup, name: RoutingItemType.GROUP },
        {
          value: AIResourceRoutingCondition,
          name: RoutingItemType.CONDITION,
        },
      ],
    },
  })
  conditions: Array<AIResourceRoutingCondition | AIRoutingConditionGroup>;

  @ApiProperty({
    enumName: 'RoutingAction',
    enum: routingActions,
    description: 'Action to take if group matches',
    example: RoutingAction.CALL_MODEL,
  })
  @IsEnum(RoutingAction)
  action: RoutingAction;

  @ApiProperty({
    enumName: 'RoutingMode',
    enum: routingModes,
    description: 'UI or advanced routing mode',
    example: RoutingMode.UI,
  })
  @IsEnum(RoutingMode)
  mode: RoutingMode;

  @ApiPropertyOptional({
    description: 'Optional expression EJS for group',
    example: '<%= request.tokens > 1000 %>',
  })
  @IsString()
  @IsOptional()
  expression?: string;

  @ApiPropertyOptional({
    type: AIResourceRoutingModelConfig,
    description: 'Model configuration to use if conditions match',
  })
  @ValidateNested()
  @Type(() => AIResourceRoutingModelConfig)
  then: AIResourceRoutingModelConfig;

  @ApiPropertyOptional({
    description: 'Whether this group is enabled',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class AIResourceModelRoutingEntity {
  @ApiProperty({
    description: 'Whether routing is enabled',
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    type: [AIRoutingConditionGroup],
    description: 'Condition groups for routing',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AIRoutingConditionGroup)
  conditions: AIRoutingConditionGroup[];
}
