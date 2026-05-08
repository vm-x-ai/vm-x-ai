import type { CompletionProvider } from '../../ai-provider/ai-provider.types';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  buildAnthropicProvider,
  buildGeminiProvider,
  buildGroqProvider,
  buildOpenAIProvider,
  buildPerplexityProvider,
  makeConnection,
  makeModel,
} from './factories';
import { hasKeys, requiredEnv } from './env';

/**
 * Per-provider live-test configuration. Each entry is independent;
 * a test parametrised by `LIVE_PROVIDERS` will skip the entries
 * whose `envKey` is absent.
 */
export type LiveProviderConfig = {
  /** Stable id used to derive describe titles + filtering. */
  id: 'openai' | 'anthropic' | 'gemini' | 'groq' | 'perplexity';
  /** Env var the provider's API key lives under. */
  envKey: string;
  /** Factory returning a fresh provider instance. */
  build: () => CompletionProvider;
  /** Model id used for plain chat scenarios. */
  model: string;
  /**
   * Whether the provider supports OpenAI-shape tool calling on the
   * model above. Skips tool-call / tool-result scenarios when false
   * so we don't accumulate flaky tests against models that don't
   * implement the contract.
   */
  supportsTools: boolean;
  /** Build a connection entity using the provider's apiKey env var. */
  buildConnection: () => AIConnectionEntity;
  buildModel: () => AIResourceModelConfigEntity;
  /**
   * One example provider-native field we expect the provider to
   * accept on either format passthrough OR through the gateway's
   * `providerArgs` escape hatch. Used by the `with provider-args`
   * scenarios.
   */
  providerSpecificArgs?: Record<string, unknown>;
};

export const LIVE_PROVIDERS: LiveProviderConfig[] = [
  {
    id: 'openai',
    envKey: 'OPENAI_API_KEY',
    build: buildOpenAIProvider,
    model: process.env.OPENAI_TEST_MODEL ?? 'gpt-4o-mini',
    supportsTools: true,
    buildConnection: () =>
      makeConnection('openai', { apiKey: requiredEnv('OPENAI_API_KEY') }),
    buildModel: () =>
      makeModel('openai', process.env.OPENAI_TEST_MODEL ?? 'gpt-4o-mini'),
    providerSpecificArgs: { service_tier: 'auto' },
  },
  {
    id: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    build: buildAnthropicProvider,
    model: process.env.ANTHROPIC_TEST_MODEL ?? 'claude-haiku-4-5',
    supportsTools: true,
    buildConnection: () =>
      makeConnection('anthropic', { apiKey: requiredEnv('ANTHROPIC_API_KEY') }),
    buildModel: () =>
      makeModel(
        'anthropic',
        process.env.ANTHROPIC_TEST_MODEL ?? 'claude-haiku-4-5'
      ),
    providerSpecificArgs: { top_k: 10 },
  },
  {
    id: 'gemini',
    envKey: 'GEMINI_API_KEY',
    build: buildGeminiProvider,
    model: process.env.GEMINI_TEST_MODEL ?? 'gemini-2.5-flash-lite',
    supportsTools: true,
    buildConnection: () =>
      makeConnection('gemini', { apiKey: requiredEnv('GEMINI_API_KEY') }),
    buildModel: () =>
      makeModel(
        'gemini',
        process.env.GEMINI_TEST_MODEL ?? 'gemini-2.5-flash-lite'
      ),
    providerSpecificArgs: { reasoning_effort: 'low' },
  },
  {
    id: 'groq',
    envKey: 'GROQ_API_KEY',
    build: buildGroqProvider,
    // Groq's tool-calling support is best on the larger llama models.
    // The 8b instant model is fast but less reliable for tool tests.
    model: process.env.GROQ_TEST_MODEL ?? 'llama-3.3-70b-versatile',
    supportsTools: true,
    buildConnection: () =>
      makeConnection('groq', { apiKey: requiredEnv('GROQ_API_KEY') }),
    buildModel: () =>
      makeModel(
        'groq',
        process.env.GROQ_TEST_MODEL ?? 'llama-3.3-70b-versatile'
      ),
    providerSpecificArgs: { service_tier: 'on_demand' },
  },
  {
    id: 'perplexity',
    envKey: 'PERPLEXITYAI_API_KEY',
    build: buildPerplexityProvider,
    model: process.env.PERPLEXITY_TEST_MODEL ?? 'sonar',
    // Perplexity's `sonar` line is search-augmented and does not
    // expose function-calling on the wire; tool-call scenarios are
    // skipped for this provider.
    supportsTools: false,
    buildConnection: () =>
      makeConnection('perplexity', {
        apiKey: requiredEnv('PERPLEXITYAI_API_KEY'),
      }),
    buildModel: () =>
      makeModel('perplexity', process.env.PERPLEXITY_TEST_MODEL ?? 'sonar'),
    // The signature Perplexity-only field — not part of OpenAI Chat
    // Completions spec but accepted by Perplexity's compat endpoint.
    providerSpecificArgs: { search_recency_filter: 'week' },
  },
];

/** True when both the live-test toggle is on and the provider's key is set. */
export function shouldRunLive(cfg: LiveProviderConfig): boolean {
  return hasKeys(cfg.envKey);
}

/** Convenience for `describe.each` titles. */
export function liveDescribeName(prefix: string, cfg: LiveProviderConfig) {
  return `${prefix} × ${cfg.id}`;
}
