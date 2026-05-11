import { describe, expect, it } from 'vitest';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { chatCompletionsToResponsesRequest } from './from-chat-completions';

describe('chatCompletionsToResponsesRequest', () => {
  it('maps a simple user-only request', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hello!' }],
    } as ChatCompletionCreateParams);
    expect(out.model).toBe('gpt-4o-mini');
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: 'Hello!' },
    ]);
    expect(out.instructions).toBeUndefined();
  });

  it('lifts a single system message into instructions', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Why?' },
      ],
    } as ChatCompletionCreateParams);
    expect(out.instructions).toBe('Be terse.');
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: 'Why?' },
    ]);
  });

  it('concatenates multiple system messages with double newlines', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'system', content: 'Cite sources.' },
        { role: 'user', content: 'Why?' },
      ],
    } as ChatCompletionCreateParams);
    expect(out.instructions).toBe('Be terse.\n\nCite sources.');
  });

  it('preserves multi-turn user/assistant alternation', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'How are you?' },
      ],
    } as ChatCompletionCreateParams);
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: 'Hi' },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello!' }],
      },
      { type: 'message', role: 'user', content: 'How are you?' },
    ]);
  });

  it('emits function_call items for assistant tool_calls', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location":"Tokyo"}',
              },
            },
          ],
        },
      ],
    } as ChatCompletionCreateParams);
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: 'weather?' },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'get_weather',
        arguments: '{"location":"Tokyo"}',
      },
    ]);
  });

  it('emits an assistant message + function_call when content + tool_call coexist', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: 'Checking now.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{}',
              },
            },
          ],
        },
      ],
    } as ChatCompletionCreateParams);
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: 'weather?' },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Checking now.' }],
      },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'get_weather',
        arguments: '{}',
      },
    ]);
  });

  it('maps tool-result messages to function_call_output', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '{"temp_c":22}',
        },
      ],
    } as ChatCompletionCreateParams);
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: 'weather?' },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'get_weather',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"temp_c":22}',
      },
    ]);
  });

  it('maps multi-modal user content to input_text + input_image parts', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe.' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,abc',
                detail: 'high',
              },
            },
          ],
        },
      ],
    } as ChatCompletionCreateParams);
    expect(out.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe.' },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,abc',
            detail: 'high',
          },
        ],
      },
    ]);
  });

  it('maps function tools to flat Responses tool shape', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the weather',
            parameters: {
              type: 'object',
              properties: { location: { type: 'string' } },
              required: ['location'],
            },
            strict: true,
          },
        },
      ],
      tool_choice: 'required',
    } as ChatCompletionCreateParams);
    expect(out.tools).toEqual([
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get the weather',
        parameters: {
          type: 'object',
          properties: { location: { type: 'string' } },
          required: ['location'],
        },
        strict: true,
      },
    ]);
    expect(out.tool_choice).toBe('required');
  });

  it('maps named tool_choice to Responses object form', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: { name: 'get_weather', parameters: {} },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'get_weather' } },
    } as ChatCompletionCreateParams);
    expect(out.tool_choice).toEqual({
      type: 'function',
      name: 'get_weather',
    });
  });

  it('maps response_format json_schema to text.format', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'country',
          strict: true,
          schema: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
            additionalProperties: false,
          },
        },
      },
    } as ChatCompletionCreateParams);
    expect(out.text).toEqual({
      format: {
        type: 'json_schema',
        name: 'country',
        description: undefined,
        schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
          additionalProperties: false,
        },
        strict: true,
      },
    });
  });

  it('maps response_format json_object to text.format', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      response_format: { type: 'json_object' },
    } as ChatCompletionCreateParams);
    expect(out.text).toEqual({ format: { type: 'json_object' } });
  });

  it('forwards reasoning_effort onto reasoning.effort', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'high',
    } as never);
    expect(out.reasoning).toEqual({ effort: 'high' });
  });

  it('forwards max_tokens / max_completion_tokens to max_output_tokens', () => {
    const a = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      max_completion_tokens: 256,
    } as never);
    expect(a.max_output_tokens).toBe(256);

    const b = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 128,
    } as never);
    expect(b.max_output_tokens).toBe(128);
  });

  it('forwards stream / parallel_tool_calls / metadata / service_tier / prompt_cache_key', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      parallel_tool_calls: false,
      metadata: { team: 'growth' },
      service_tier: 'auto',
      prompt_cache_key: 'cache-key-1',
    } as never);
    expect((out as { stream?: boolean }).stream).toBe(true);
    expect(out.parallel_tool_calls).toBe(false);
    expect(out.metadata).toEqual({ team: 'growth' });
    expect((out as { service_tier?: string }).service_tier).toBe('auto');
    expect((out as { prompt_cache_key?: string }).prompt_cache_key).toBe(
      'cache-key-1'
    );
  });

  it('carries vmx envelope through verbatim', () => {
    const vmx = {
      correlationId: 'agent-1',
      metadata: { team: 'growth' },
      timeoutMs: 15000,
    };
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      vmx,
    } as never);
    expect((out as { vmx?: unknown }).vmx).toBe(vmx);
  });

  it('carries __vmx_passthrough through verbatim', () => {
    const passthrough = {
      anthropic: {
        cache_control: { type: 'ephemeral' },
        top_k: 10,
      },
    };
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      __vmx_passthrough: passthrough,
    } as never);
    expect((out as { __vmx_passthrough?: unknown }).__vmx_passthrough).toBe(
      passthrough
    );
  });

  it('developer role messages collapse into instructions', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'developer', content: 'Speak in haiku.' } as never,
        { role: 'user', content: 'Why is the sky blue?' },
      ],
    } as ChatCompletionCreateParams);
    expect(out.instructions).toBe('Speak in haiku.');
  });

  it('drops audio / file content parts and keeps text+image', () => {
    const out = chatCompletionsToResponsesRequest({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe.' },
            {
              type: 'input_audio',
              input_audio: { data: 'b64', format: 'wav' },
            } as never,
            { type: 'file', file: { file_id: 'f-1' } } as never,
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,xyz' },
            },
          ],
        },
      ],
    } as ChatCompletionCreateParams);
    const userItem = out.input?.[0] as {
      type: string;
      content: Array<{ type: string }>;
    };
    expect(userItem.content.map((p) => p.type)).toEqual([
      'input_text',
      'input_image',
    ]);
  });
});
