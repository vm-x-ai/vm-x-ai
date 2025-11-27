import { RoutingComparator, RoutingConditionType } from '@/clients/api';

type RuleOption = {
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
};

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
];

export const DefaultRulesMap = DefaultRulesOptions.reduce<
  Record<string, RuleOption>
>((acc, option) => {
  return { ...acc, [option.id]: option };
}, {});
