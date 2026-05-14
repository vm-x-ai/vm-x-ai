import { describe, expect, it } from 'vitest';
import {
  classifyAnthropicServerTool,
  isServerToolHistoryBlock,
  liftAnthropicServerToolBlockToText,
  raiseUnsupportedServerTool,
} from './anthropic-server-tools';

describe('classifyAnthropicServerTool', () => {
  it.each([
    [{ name: 'x', input_schema: { type: 'object' } }, 'custom'],
    [{ type: 'web_search_20250305', name: 'web_search' }, 'web_search'],
    [{ type: 'web_search_20260209', name: 'web_search' }, 'web_search'],
    [{ type: 'web_fetch_20250910', name: 'web_fetch' }, 'web_fetch'],
    [
      { type: 'code_execution_20250522', name: 'code_execution' },
      'code_execution',
    ],
    [
      { type: 'code_execution_20260120', name: 'code_execution' },
      'code_execution',
    ],
    [{ type: 'bash_20250124', name: 'bash' }, 'bash'],
    [
      { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' },
      'text_editor',
    ],
    [{ type: 'memory_20250818', name: 'memory' }, 'memory'],
    [
      { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },
      'tool_search',
    ],
    [{ type: 'computer_use_20241022', name: 'computer' }, 'computer'],
    [{ type: 'something_unknown_20990101', name: 'x' }, 'unknown'],
  ])('classifies %j as %s', (tool, expected) => {
    expect(classifyAnthropicServerTool(tool as never)).toBe(expected);
  });
});

describe('raiseUnsupportedServerTool', () => {
  it.each([
    ['gemini', 'anthropic_server_tool_unsupported_on_gemini', 'Gemini'],
    [
      'bedrock_converse',
      'anthropic_server_tool_unsupported_on_bedrock_converse',
      'AWS Bedrock Converse',
    ],
    [
      'openai_responses',
      'anthropic_server_tool_unsupported_on_openai_responses',
      'OpenAI Responses',
    ],
  ])('emits the %s 400 code', (target, code, label) => {
    expect(() =>
      raiseUnsupportedServerTool(
        ['bash_20250124', 'memory_20250818'],
        target as 'gemini' | 'bedrock_converse' | 'openai_responses'
      )
    ).toThrowError(
      expect.objectContaining({
        data: expect.objectContaining({
          statusCode: 400,
          retryable: false,
          rate: false,
          message: expect.stringContaining(label),
          openAICompatibleError: expect.objectContaining({
            code,
            type: 'invalid_request_error',
          }),
        }),
      })
    );
  });
});

describe('isServerToolHistoryBlock', () => {
  it.each([
    'server_tool_use',
    'web_search_tool_result',
    'web_fetch_tool_result',
    'code_execution_tool_result',
    'bash_code_execution_tool_result',
    'text_editor_code_execution_tool_result',
    'tool_search_tool_result',
    'container_upload',
  ])('returns true for %s', (type) => {
    expect(isServerToolHistoryBlock({ type } as never)).toBe(true);
  });

  it.each(['text', 'tool_use', 'tool_result', 'image', 'thinking'])(
    'returns false for %s',
    (type) => {
      expect(isServerToolHistoryBlock({ type } as never)).toBe(false);
    }
  );
});

describe('liftAnthropicServerToolBlockToText', () => {
  it('renders web_search_tool_result rows as bulleted title + url lines', () => {
    const out = liftAnthropicServerToolBlockToText({
      type: 'web_search_tool_result',
      tool_use_id: 'srv',
      content: [
        {
          type: 'web_search_result',
          title: 'A',
          url: 'https://a.test',
          encrypted_content: 'e',
        },
        {
          type: 'web_search_result',
          title: 'B',
          url: 'https://b.test',
          encrypted_content: 'e',
        },
      ],
    });
    expect(out?.text).toContain('- A <https://a.test>');
    expect(out?.text).toContain('- B <https://b.test>');
  });

  it('renders code_execution_tool_result with stdout / stderr / return_code', () => {
    const out = liftAnthropicServerToolBlockToText({
      type: 'code_execution_tool_result',
      tool_use_id: 'srv',
      content: {
        type: 'code_execution_result',
        return_code: 1,
        stdout: 'partial',
        stderr: 'boom',
        content: [],
      },
    });
    expect(out?.text).toContain('exit 1');
    expect(out?.text).toContain('stdout:\npartial');
    expect(out?.text).toContain('stderr:\nboom');
  });

  it('renders server_tool_use as a JSON-encoded invocation tag', () => {
    const out = liftAnthropicServerToolBlockToText({
      type: 'server_tool_use',
      id: 'srv_1',
      name: 'web_search',
      input: { query: 'hello' },
    });
    expect(out?.text).toContain('[server_tool_use:web_search]');
    expect(out?.text).toContain('"query":"hello"');
  });

  it('renders web_fetch_tool_result error blocks with the error code', () => {
    const out = liftAnthropicServerToolBlockToText({
      type: 'web_fetch_tool_result',
      tool_use_id: 'srv',
      content: {
        type: 'web_fetch_tool_result_error',
        error_code: 'url_not_allowed',
      },
    });
    expect(out?.text).toContain('[web_fetch_tool_result:error]');
    expect(out?.text).toContain('url_not_allowed');
  });

  it('returns null for unrecognised block types', () => {
    expect(
      liftAnthropicServerToolBlockToText({ type: 'text', text: 'hi' } as never)
    ).toBeNull();
  });
});
