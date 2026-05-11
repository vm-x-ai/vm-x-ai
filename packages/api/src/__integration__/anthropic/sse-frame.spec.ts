import { describe, expect, it } from 'vitest';
import {
  formatAnthropicErrorFrame,
  formatAnthropicPingFrame,
  formatAnthropicSseFrame,
} from '../../gateway/anthropic/sse-frame';

/**
 * T3: every typed Anthropic SSE chunk must ship as
 * `event: <type>\ndata: <json>\n\n`. Strict consumers (notably the
 * Anthropic SDK's MessageStream parser) route on the `event:` line
 * and miss frames that ship `data:` only.
 */

describe('Anthropic SSE frame formatter (T3)', () => {
  it('emits both event: and data: lines for typed chunks', () => {
    const frame = formatAnthropicSseFrame({
      type: 'message_start',
      message: { id: 'msg_1', role: 'assistant' },
    });
    expect(frame).toMatch(/^event: message_start\n/);
    expect(frame).toContain('\ndata: {');
    expect(frame.endsWith('\n\n')).toBe(true);
  });

  it.each([
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
    'ping',
  ])('emits event: %s for typed chunks', (eventType) => {
    const frame = formatAnthropicSseFrame({ type: eventType });
    expect(frame).toMatch(new RegExp(`^event: ${eventType}\\n`));
  });

  it('falls back to data:-only when chunk has no type field', () => {
    const frame = formatAnthropicSseFrame({ choices: [{ delta: {} }] });
    expect(frame.startsWith('event:')).toBe(false);
    expect(frame.startsWith('data: ')).toBe(true);
  });

  it('formats ping heartbeat with both event: and data: lines', () => {
    const frame = formatAnthropicPingFrame();
    expect(frame).toBe(
      `event: ping\ndata: ${JSON.stringify({ type: 'ping' })}\n\n`
    );
  });

  it('formats mid-stream error with typed event: error frame', () => {
    const frame = formatAnthropicErrorFrame({
      error: { message: 'rate limited', code: 'rate_limit_exceeded' },
    });
    expect(frame).toMatch(/^event: error\n/);
    expect(frame).toContain('"rate_limit_exceeded"');
  });

  it('payload survives JSON round-trip on event frames', () => {
    const chunk = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    };
    const frame = formatAnthropicSseFrame(chunk);
    const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse(dataLine!.slice('data: '.length));
    expect(parsed).toEqual(chunk);
  });
});
