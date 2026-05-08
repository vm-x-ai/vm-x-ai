import { ApiProperty } from '@nestjs/swagger';

/**
 * Per-row summary returned by the model-pricing import endpoint. Lists
 * which `provider/model` keys were inserted, updated, or left
 * unchanged, plus a count of each. The shape lets the UI render a
 * "5 created, 12 updated, 264 unchanged" toast without parsing
 * arbitrary text.
 */
export class ImportModelPricingResultDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'string' },
    description:
      "`provider/model` keys that were inserted because no existing row matched. New rows are tagged source = 'USER' regardless of any `source` value in the file (the importer ignores the column).",
  })
  created: string[];

  @ApiProperty({
    type: 'array',
    items: { type: 'string' },
    description:
      "`provider/model` keys that existed and had at least one cost field change. The row's source is promoted to 'USER' on every update so the next pricing sync doesn't clobber the operator's edit.",
  })
  updated: string[];

  @ApiProperty({
    type: 'array',
    items: { type: 'string' },
    description:
      "`provider/model` keys that existed and matched the file's costs exactly. Source is left untouched — a 'SYSTEM' row stays 'SYSTEM', so the pricing sync can keep refreshing it.",
  })
  unchanged: string[];

  @ApiProperty({
    description: 'Total rows processed.',
    example: 281,
  })
  total: number;
}
