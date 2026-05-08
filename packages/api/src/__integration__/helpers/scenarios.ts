import type { ChatCompletionCreateParams } from 'openai/resources/index.js';

/**
 * Minimal user turn that should always work across providers. Use a
 * deterministic prompt so flaky model wording doesn't break assertions.
 */
export const simplePrompt: ChatCompletionCreateParams = {
  model: 'placeholder',
  messages: [
    {
      role: 'user',
      content: 'Reply with exactly the word: pong',
    },
  ],
  max_tokens: 16,
  temperature: 0,
};

/**
 * A weather function tool. The user message asks for weather in a city,
 * which should reliably trigger tool selection across all tool-capable
 * providers (OpenAI, Anthropic, Bedrock, Groq, Gemini).
 */
export const toolCallPrompt: ChatCompletionCreateParams = {
  model: 'placeholder',
  messages: [
    {
      role: 'user',
      content:
        "What's the current temperature in Tokyo? Use the get_weather tool.",
    },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather in a city',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'City name, e.g. "Tokyo"',
            },
          },
          required: ['location'],
        },
      },
    },
  ],
  tool_choice: 'auto',
  max_tokens: 256,
  temperature: 0,
};

/**
 * Used to verify provider-specific web-search passthrough. The exact
 * shape of "web search" varies by provider: OpenAI uses a search-class
 * model + web_search_options; Perplexity returns citations + search_results
 * automatically with sonar models; Gemini uses tools=[{googleSearch:{}}].
 *
 * Each provider spec wires this up in its own way — this is just the
 * prompt. The question is intentionally about something that
 * (a) is unlikely to be answerable from training data alone (recent
 * news / time-sensitive) and (b) strongly nudges the model to issue a
 * search query so we get citation/grounding metadata back to assert
 * on. Without the nudge, search-class models sometimes answer from
 * pretraining and skip the search call, leaving us with zero
 * citations to assert against.
 */
export const webSearchPrompt = {
  question:
    'Search the web for the latest news about Anthropic from this week and summarise the top story in one sentence with a citation.',
};

/**
 * Multi-turn conversation following a tool call — used to verify that
 * the gateway correctly preserves tool_call_id linkage when relaying
 * tool responses to the provider.
 */
export const toolFollowupPrompt = (
  toolCallId: string
): ChatCompletionCreateParams => ({
  model: 'placeholder',
  messages: [
    {
      role: 'user',
      content:
        "What's the current temperature in Tokyo? Use the get_weather tool.",
    },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: toolCallId,
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: JSON.stringify({ location: 'Tokyo' }),
          },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: toolCallId,
      content: '15 °C, partly cloudy',
    },
  ],
  max_tokens: 128,
  temperature: 0,
});

/**
 * Structured output scenario. Mirrors how downstream callers drive the
 * gateway with `response_format: json_schema` to force valid JSON
 * conforming to a known shape.
 *
 * The schema asks for two-letter ISO country codes for Tokyo. We assert the
 * model's response parses as valid JSON conforming to this shape.
 */
export const structuredOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['city', 'country_code'],
  properties: {
    city: { type: 'string' },
    country_code: {
      type: 'string',
      description: 'ISO 3166-1 alpha-2 code, uppercase, e.g. "JP"',
    },
  },
} as const;

export const structuredOutputPrompt: ChatCompletionCreateParams = {
  model: 'placeholder',
  messages: [
    {
      role: 'user',
      content:
        'Return the city Tokyo and its ISO 3166-1 alpha-2 country code as JSON.',
    },
  ],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'CityCountryCode',
      schema: structuredOutputSchema as unknown as Record<string, unknown>,
      strict: true,
    },
  },
  max_tokens: 128,
  temperature: 0,
};

export type StructuredOutputShape = {
  city: string;
  country_code: string;
};

/**
 * Reasoning-model prompt — used to verify that reasoning_tokens flow
 * through usage on providers that emit them (OpenAI o-series, etc).
 */
export const reasoningPrompt: ChatCompletionCreateParams = {
  model: 'placeholder',
  messages: [
    {
      role: 'user',
      content:
        'Think briefly, then answer: what is the smallest 3-digit prime number? Reply with just the number.',
    },
  ],
  max_tokens: 1024,
  temperature: 0,
};
