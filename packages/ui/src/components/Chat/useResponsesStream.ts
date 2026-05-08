'use client';

import { useCallback, useRef, useState } from 'react';
import type { AiResourceEntity } from '@/clients/api';
import type { ChatMessage, ChatMessageMetadata } from './types';

/**
 * Minimal Responses-API client hook.
 *
 * Mirrors the slice of `useChat` API the playground uses (`messages`,
 * `sendMessage`, `setMessages`, `status`, `error`) so Chat.tsx can branch
 * cleanly on endpoint mode without rewiring the rest of its UI.
 *
 * Phase 1 only handles text deltas (`response.output_text.delta`) and the
 * terminal events (`response.completed`, `response.failed`). Tool-call /
 * reasoning event handling is a follow-up.
 */
export type UseResponsesStreamArgs = {
  workspaceId?: string;
  environmentId?: string;
};

export type ResponsesStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export type UseResponsesStreamReturn = {
  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[]) => void;
  status: ResponsesStatus;
  error: Error | undefined;
  sendMessage: (
    payload: { text: string },
    options?: {
      body?: {
        resourceConfigOverrides?: Partial<AiResourceEntity>;
        webSearch?: boolean;
      };
    }
  ) => Promise<void>;
};

function makeId(prefix: string): string {
  // crypto.randomUUID is available in modern browsers and Node 19+.
  return `${prefix}-${
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  }`;
}

/**
 * Parse a single SSE block (event lines + data lines separated by \n\n).
 * Returns null when the block has no `data:` payload (e.g. comment-only).
 */
function parseSseBlock(
  block: string
): { event: string | null; data: string } | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      // Per spec, multiple `data:` lines join with newline; strip the leading space.
      dataLines.push(line.slice(5).replace(/^\s/, ''));
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

export function useResponsesStream({
  workspaceId,
  environmentId,
}: UseResponsesStreamArgs): UseResponsesStreamReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ResponsesStatus>('ready');
  const [error, setError] = useState<Error | undefined>();
  // Latest assistant message id we're streaming into. Stored in a ref so
  // event-loop callbacks can append text without going through React state.
  const activeAssistantIdRef = useRef<string | null>(null);

  const appendDelta = useCallback((delta: string) => {
    setMessages((prev) => {
      const id = activeAssistantIdRef.current;
      if (!id) return prev;
      return prev.map((m) => {
        if (m.id !== id) return m;
        // We always keep a single text part on the assistant message and
        // grow it in place — much simpler than splitting per-chunk.
        const updatedParts = m.parts.map((p) =>
          p.type === 'text' ? { ...p, text: p.text + delta } : p
        );
        return { ...m, parts: updatedParts };
      });
    });
  }, []);

  const sendMessage: UseResponsesStreamReturn['sendMessage'] = useCallback(
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
      activeAssistantIdRef.current = assistantMsg.id;

      const sentMessages = [...messages, userMsg, assistantMsg];
      setMessages(sentMessages);

      try {
        const resp = await fetch('/api/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            environmentId,
            // The BFF sends only completed user/assistant turns to the API,
            // so omit the assistant placeholder we just appended.
            messages: sentMessages.slice(0, -1),
            resourceConfigOverrides: options?.body?.resourceConfigOverrides,
            webSearch: options?.body?.webSearch,
          }),
        });

        if (!resp.ok || !resp.body) {
          const errText = await resp.text();
          throw new Error(`Responses API error (${resp.status}): ${errText}`);
        }

        const metadata: ChatMessageMetadata = {
          model: resp.headers.get('x-vmx-model') ?? '',
          provider: resp.headers.get('x-vmx-provider') ?? '',
          connectionId: resp.headers.get('x-vmx-connection-id') ?? '',
          requestId: resp.headers.get('x-vmx-request-id') ?? '',
        };
        // Stamp the metadata onto the assistant message so the chat panel
        // shows the routed model/provider chip.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? ({ ...m, metadata } as ChatMessage) : m
          )
        );

        setStatus('streaming');

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE blocks are separated by two newlines. Drain whole blocks
          // and keep any trailing partial in the buffer.
          let separatorIdx = buffer.indexOf('\n\n');
          while (separatorIdx !== -1) {
            const rawBlock = buffer.slice(0, separatorIdx);
            buffer = buffer.slice(separatorIdx + 2);
            const parsed = parseSseBlock(rawBlock);
            if (parsed) {
              try {
                const payload = JSON.parse(parsed.data);
                const eventType =
                  parsed.event ?? (payload.type as string | undefined);
                if (eventType === 'response.output_text.delta') {
                  if (typeof payload.delta === 'string') {
                    appendDelta(payload.delta);
                  }
                } else if (eventType === 'response.failed') {
                  const message =
                    payload?.response?.error?.message ??
                    'Responses request failed';
                  throw new Error(message);
                }
                // response.completed and other event types are intentionally
                // ignored in Phase 1 — the assistant text is already up to date.
              } catch (err) {
                // A bad event payload shouldn't tank the whole stream — log
                // and keep going. The error surface for the user only fires
                // on response.failed or fetch-level failure.
                if (err instanceof Error && err.message.includes('failed')) {
                  throw err;
                }
                // Swallow JSON parse errors silently.
              }
            }
            separatorIdx = buffer.indexOf('\n\n');
          }
        }

        activeAssistantIdRef.current = null;
        setStatus('ready');
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
        activeAssistantIdRef.current = null;
      }
    },
    [messages, workspaceId, environmentId, appendDelta]
  );

  return {
    messages,
    setMessages,
    status,
    error,
    sendMessage,
  };
}
