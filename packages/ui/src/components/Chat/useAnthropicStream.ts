'use client';

import { useCallback, useState } from 'react';
import type { AiResourceEntity } from '@/clients/api';
import type { ChatMessage, ChatMessageMetadata } from './types';

/**
 * Anthropic Messages API client hook for the Playground.
 *
 * Non-streaming only for now — Anthropic SSE event-shape conversion
 * (`message_start` / `content_block_delta` / `message_delta` / `message_stop`)
 * is a Phase 11B follow-up. For the playground this is fine: the
 * gateway returns the full Anthropic message in one shot and we
 * splice its `content[0].text` into the assistant placeholder.
 *
 * Mirrors the slice of `useChat` API the playground uses so Chat.tsx
 * can branch on endpoint mode without rewiring its UI: `messages`,
 * `setMessages`, `status`, `error`, `sendMessage`.
 */
export type UseAnthropicStreamArgs = {
  workspaceId?: string;
  environmentId?: string;
};

export type AnthropicStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export type UseAnthropicStreamReturn = {
  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[]) => void;
  status: AnthropicStatus;
  error: Error | undefined;
  sendMessage: (
    payload: { text: string },
    options?: {
      body?: {
        resourceConfigOverrides?: Partial<AiResourceEntity>;
      };
    }
  ) => Promise<void>;
};

type AnthropicMessageResponse = {
  id?: string;
  content?: Array<{ type: string; text?: string }>;
};

function makeId(prefix: string): string {
  return `${prefix}-${
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  }`;
}

export function useAnthropicStream({
  workspaceId,
  environmentId,
}: UseAnthropicStreamArgs): UseAnthropicStreamReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AnthropicStatus>('ready');
  const [error, setError] = useState<Error | undefined>();

  const sendMessage: UseAnthropicStreamReturn['sendMessage'] = useCallback(
    async ({ text }, options) => {
      setError(undefined);
      setStatus('submitted');

      const userMsg: ChatMessage = {
        id: makeId('user'),
        role: 'user',
        parts: [{ type: 'text', text }],
      } as ChatMessage;
      const assistantMsg: ChatMessage = {
        id: makeId('asst'),
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
      } as ChatMessage;

      const sentMessages = [...messages, userMsg, assistantMsg];
      setMessages(sentMessages);

      try {
        const resp = await fetch('/api/anthropic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            environmentId,
            // Strip the assistant placeholder we just appended — the
            // BFF only forwards completed turns to Anthropic.
            messages: sentMessages.slice(0, -1),
            resourceConfigOverrides: options?.body?.resourceConfigOverrides,
          }),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Anthropic API error (${resp.status}): ${errText}`);
        }

        const metadata: ChatMessageMetadata = {
          model: resp.headers.get('x-vmx-model') ?? '',
          provider: resp.headers.get('x-vmx-provider') ?? '',
          connectionId: resp.headers.get('x-vmx-connection-id') ?? '',
          requestId: resp.headers.get('x-vmx-request-id') ?? '',
        };

        const payload = (await resp.json()) as AnthropicMessageResponse;
        const assistantText =
          payload.content
            ?.filter((c) => c.type === 'text' && typeof c.text === 'string')
            .map((c) => c.text as string)
            .join('') ?? '';

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? ({
                  ...m,
                  metadata,
                  parts: [{ type: 'text', text: assistantText }],
                } as ChatMessage)
              : m
          )
        );
        setStatus('ready');
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      }
    },
    [messages, workspaceId, environmentId]
  );

  return {
    messages,
    setMessages,
    status,
    error,
    sendMessage,
  };
}
