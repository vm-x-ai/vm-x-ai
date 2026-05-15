import { RoutingComparator, RoutingConditionType } from '@/clients/api';

export type RuleOption = {
  id: string;
  expression: string;
  label: string;
  comparator: RoutingComparator;
  value: {
    type: RoutingConditionType;
    label: string;
    value?: unknown;
    readOnly?: boolean;
  };
  /**
   * When set, the rule's LHS is a metadata field lookup
   * (`request.metadata[<field>]`). The ConditionCard renders a
   * field-picker (autocompleted from observed metadata keys) and a
   * value-picker (autocompleted from observed values for the chosen
   * field) instead of the single static value input that the other
   * presets use. The chosen field is encoded into `expression` so
   * the routing engine can dereference it at request time.
   */
  metadataField?: boolean;
};

/**
 * Build the routing-engine path for a metadata-field rule. Uses the
 * top-level `metadata` namespace (alias of `request.metadata` in the
 * template variables) for the shortest readable path. `lodash.get`
 * handles missing keys safely, so no optional chaining is needed.
 */
export function buildMetadataExpression(field: string): string {
  return `metadata['${field}']`;
}

/**
 * Recover the metadata field name from a stored expression. Returns
 * `null` when the expression doesn't match the metadata-rule shape
 * (e.g. user switched the rule type, or hand-edited the template).
 *
 * Tolerates the old `request.metadata?.['<field>']` shape persisted
 * by earlier versions of the rule editor — `?.` was the original
 * defensive default but doesn't survive `lodash.get` path parsing,
 * so newer saves use `metadata['<field>']`. Both round-trip the same
 * field name out.
 */
export function parseMetadataField(expression: string): string | null {
  const match = expression.match(/^(?:request\.)?metadata\??\.?\['([^']*)'\]$/);
  return match?.[1] ?? null;
}

export const DefaultRulesOptions: RuleOption[] = [
  {
    id: 'prompt_length_less_than_tokens',
    expression: 'tokens.input',
    label: 'Prompt length less than ... tokens',
    comparator: RoutingComparator.LESS_THAN,
    value: {
      type: RoutingConditionType.NUMBER,
      label: 'tokens',
    },
  },
  {
    id: 'prompt_length_more_than_tokens',
    expression: 'tokens.input',
    label: 'Prompt length more than ... tokens',
    comparator: RoutingComparator.GREATER_THAN,
    value: {
      type: RoutingConditionType.NUMBER,
      label: 'tokens',
    },
  },
  {
    id: 'prompt_length_less_than_characters',
    expression: 'request.allMessagesContent.length',
    label: 'Prompt length less than ... characters',
    comparator: RoutingComparator.LESS_THAN,
    value: {
      type: RoutingConditionType.NUMBER,
      label: 'characters',
    },
  },
  {
    id: 'prompt_length_more_than_characters',
    expression: 'request.allMessagesContent.length',
    label: 'Prompt length more than ... characters',
    comparator: RoutingComparator.GREATER_THAN,
    value: {
      type: RoutingConditionType.NUMBER,
      label: 'characters',
    },
  },
  {
    id: 'last_message_contains',
    expression: 'request.lastMessage.content',
    label: 'Last user prompt contains ...',
    comparator: RoutingComparator.CONTAINS,
    value: {
      type: RoutingConditionType.STRING,
      label: 'text',
    },
  },
  {
    id: 'last_message_contains_pattern',
    expression: 'request.lastMessage.content',
    label: 'Last user prompt contains pattern...',
    comparator: RoutingComparator.PATTERN,
    value: {
      type: RoutingConditionType.STRING,
      label: 'regex pattern',
    },
  },
  {
    id: 'any_message_contains',
    expression: 'request.allMessagesContent',
    label: 'Any message contains ...',
    comparator: RoutingComparator.CONTAINS,
    value: {
      type: RoutingConditionType.STRING,
      label: 'text',
    },
  },
  {
    id: 'has_tools',
    expression: 'request.toolsCount',
    label: 'Has tools',
    comparator: RoutingComparator.GREATER_THAN,
    value: {
      type: RoutingConditionType.NUMBER,
      label: 'Tools',
      value: 0,
      readOnly: true,
    },
  },
  {
    id: 'error_rate_5_minutes_window',
    expression: '<% return errorRate(5) %>',
    label: 'Error rate in last 5 minutes is greater than ...',
    comparator: RoutingComparator.GREATER_THAN,
    value: {
      type: RoutingConditionType.NUMBER,
      label: 'Error Rate (%)',
      value: 0,
    },
  },
  {
    id: 'error_rate_10_minutes_window',
    expression: '<% return errorRate(10) %>',
    label: 'Error rate in last 10 minutes is greater than ...',
    comparator: RoutingComparator.GREATER_THAN,
    value: {
      type: RoutingConditionType.NUMBER,
      label: 'Error Rate (%)',
      value: 0,
    },
  },
  {
    id: 'capacity_tokens_usage_minute_greater_than',
    expression:
      '<% return (await capacityUsage("minute"))?.tokensUsagePercent %>',
    label: 'Token usage (last minute) is greater than ...',
    comparator: RoutingComparator.GREATER_THAN,
    value: {
      type: RoutingConditionType.NUMBER,
      label: 'Usage (%)',
      value: 0,
    },
  },
  {
    id: 'capacity_requests_usage_minute_greater_than',
    expression:
      '<% return (await capacityUsage("minute"))?.requestsUsagePercent %>',
    label: 'Request usage (last minute) is greater than ...',
    comparator: RoutingComparator.GREATER_THAN,
    value: {
      type: RoutingConditionType.NUMBER,
      label: 'Usage (%)',
      value: 0,
    },
  },
  {
    id: 'capacity_remaining_tokens_minute_less_than',
    expression: '<% return (await capacityUsage("minute"))?.remainingTokens %>',
    label: 'Remaining tokens (this minute) less than ...',
    comparator: RoutingComparator.LESS_THAN,
    value: {
      type: RoutingConditionType.NUMBER,
      label: 'tokens',
    },
  },
  {
    id: 'capacity_remaining_requests_minute_less_than',
    expression:
      '<% return (await capacityUsage("minute"))?.remainingRequests %>',
    label: 'Remaining requests (this minute) less than ...',
    comparator: RoutingComparator.LESS_THAN,
    value: {
      type: RoutingConditionType.NUMBER,
      label: 'requests',
    },
  },
  {
    // Parametrised — the ConditionCard renders a field picker
    // (autocompleted from the metadata keys observed on recent
    // audits) plus a value picker (autocompleted from values
    // observed for the chosen field). The chosen field is encoded
    // into the stored expression via `buildMetadataExpression`.
    id: 'metadata_equals',
    expression: buildMetadataExpression(''),
    label: 'Metadata field equals ...',
    comparator: RoutingComparator.EQUAL,
    value: {
      type: RoutingConditionType.STRING,
      label: 'value',
    },
    metadataField: true,
  },
];

export const DefaultRulesMap = DefaultRulesOptions.reduce<
  Record<string, RuleOption>
>((acc, option) => {
  return { ...acc, [option.id]: option };
}, {});
