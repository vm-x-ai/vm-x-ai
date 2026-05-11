import { describe, expect, it } from 'vitest';
import { hasKeys, requiredEnv } from '../helpers/env';
import {
  buildAnthropicProvider,
  makeConnection,
  makeModel,
} from '../helpers/factories';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type { Message as AnthropicMessage } from '@anthropic-ai/sdk/resources/messages';

/**
 * Live tests for the Anthropic-side fixes that only matter against
 * real upstream behaviour: signed-thinking multi-turn continuity (T2)
 * and `betas[]` plumbing (T9). Unit tests pin the converter shapes;
 * these confirm Anthropic's signature validator + beta-feature
 * plumbing actually accept what the gateway produces.
 */

const SHOULD_RUN = hasKeys('ANTHROPIC_API_KEY');
const TEST_MODEL = process.env.ANTHROPIC_TEST_MODEL ?? 'claude-haiku-4-5';
const TIMEOUT = 90_000;

describe.skipIf(!SHOULD_RUN)('Anthropic fixes (live)', () => {
  const provider = buildAnthropicProvider();
  const connection = makeConnection('anthropic', {
    apiKey: SHOULD_RUN ? requiredEnv('ANTHROPIC_API_KEY') : '',
  });
  const model = makeModel('anthropic', TEST_MODEL);

  // ─── L2: signed-thinking continuity round-trip ──────────────────
  it(
    'L2: re-sending an assistant turn (text + thinking + signature) is accepted',
    async () => {
      // Turn 1 — request extended thinking.
      const turn1: AnthropicMessagesRequest = {
        model: TEST_MODEL,
        max_tokens: 2048,
        thinking: { type: 'enabled', budget_tokens: 1024 },
        messages: [
          {
            role: 'user',
            content:
              'Briefly think about the prime factorisation of 84, then state it.',
          },
        ],
      } as AnthropicMessagesRequest;

      const r1 = await provider.anthropicMessages(turn1, connection, model);
      const m1 = r1.data as AnthropicMessage;
      expect(m1.content).toBeDefined();
      // Capture the full assistant content array — must include the
      // thinking block with its signature for round-trip continuity.
      const assistantContent = m1.content;
      const hasThinking = assistantContent.some(
        (b) => b.type === 'thinking' || b.type === 'redacted_thinking'
      );
      expect(
        hasThinking,
        'turn 1 should produce a thinking block (extended thinking enabled)'
      ).toBe(true);

      // Turn 2 — re-send the assistant turn verbatim, then ask a
      // follow-up. If T2's signature round-trip is broken, Anthropic
      // returns "invalid thinking signature" and the request 400s.
      const turn2: AnthropicMessagesRequest = {
        model: TEST_MODEL,
        max_tokens: 2048,
        thinking: { type: 'enabled', budget_tokens: 1024 },
        messages: [
          turn1.messages[0],
          {
            role: 'assistant',
            content: assistantContent,
          },
          {
            role: 'user',
            content: 'And what is the largest prime factor?',
          },
        ],
      } as AnthropicMessagesRequest;

      const r2 = await provider.anthropicMessages(turn2, connection, model);
      const m2 = r2.data as AnthropicMessage;
      // Anthropic accepted the re-injected signed thinking — no
      // exception — and produced a follow-up response.
      expect(m2.content).toBeDefined();
      expect(m2.content.length).toBeGreaterThan(0);
    },
    TIMEOUT
  );

  // ─── L9: betas[] plumbing — interleaved-thinking opt-in ─────────
  it(
    'L9: passing betas: [interleaved-thinking-2025-05-14] is accepted',
    async () => {
      // Send a body that opts into the interleaved-thinking beta. The
      // assertion is "the request doesn't 400 with `unknown_beta`" —
      // before T9 the field was silently dropped, after T9 it's
      // forwarded onto the wire and Anthropic's beta-validator either
      // honours it or surfaces a clean error.
      const body = {
        model: TEST_MODEL,
        max_tokens: 256,
        thinking: { type: 'enabled', budget_tokens: 1024 },
        betas: ['interleaved-thinking-2025-05-14'],
        messages: [
          {
            role: 'user',
            content:
              'Think step by step about whether 19 is prime, then say yes or no.',
          },
        ],
      } as AnthropicMessagesRequest;

      const r = await provider.anthropicMessages(body, connection, model);
      const m = r.data as AnthropicMessage;
      expect(m.content).toBeDefined();
      expect(m.content.length).toBeGreaterThan(0);
    },
    TIMEOUT
  );
});
