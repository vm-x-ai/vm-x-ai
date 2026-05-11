import { describe, expect, it } from 'vitest';
import { formatPlainDecimal, fromCsv, toCsv } from './csv-codec';

describe('formatPlainDecimal', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [1.5, '1.5'],
    [5e-6, '0.000005'],
    [3e-7, '0.0000003'], // would be '3e-7' with default String()
    [1e-9, '0.000000001'],
    [0.0000025, '0.0000025'],
    [-3e-7, '-0.0000003'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatPlainDecimal(input)).toBe(expected);
  });

  it('round-trips parseFloat → number → format for tiny values', () => {
    const original = 3e-7;
    const text = formatPlainDecimal(original);
    expect(parseFloat(text)).toBe(original);
  });
});

describe('toCsv', () => {
  it('serializes a simple row set with the requested column order', () => {
    const csv = toCsv(
      [
        { provider: 'openai', model: 'gpt-4o', input: 5e-6 },
        { provider: 'anthropic', model: 'claude-haiku-4-5', input: 1e-6 },
      ],
      ['provider', 'model', 'input']
    );
    expect(csv).toBe(
      'provider,model,input\n' +
        'openai,gpt-4o,0.000005\n' +
        'anthropic,claude-haiku-4-5,0.000001\n'
    );
  });

  it('renders small numbers as plain decimals (no scientific notation)', () => {
    // Regression: `String(3e-7) === '3e-7'` flips to exponential and
    // showed up in exported CSVs as `3e-7` instead of `0.0000003`.
    const csv = toCsv(
      [{ provider: 'anthropic', model: 'claude', cached: 3e-7 }],
      ['provider', 'model', 'cached']
    );
    expect(csv).toBe(
      'provider,model,cached\n' + 'anthropic,claude,0.0000003\n'
    );
  });

  it('quotes cells that contain commas, quotes, or newlines', () => {
    const csv = toCsv(
      [{ a: 'comma, here', b: 'she said "hi"', c: 'line\nbreak' }],
      ['a', 'b', 'c']
    );
    expect(csv).toBe(
      'a,b,c\n' + '"comma, here","she said ""hi""","line\nbreak"\n'
    );
  });

  it('renders null / undefined as an empty cell', () => {
    const csv = toCsv(
      [{ a: 1, b: null as unknown, c: undefined as unknown }],
      ['a', 'b', 'c']
    );
    expect(csv).toBe('a,b,c\n' + '1,,\n');
  });
});

describe('fromCsv', () => {
  it('parses a header + rows into objects keyed by the header', () => {
    const rows = fromCsv(
      'provider,model,inputCostPerToken\n' +
        'openai,gpt-4o,0.000005\n' +
        'anthropic,claude-haiku-4-5,0.000001\n'
    );
    expect(rows).toEqual([
      {
        provider: 'openai',
        model: 'gpt-4o',
        inputCostPerToken: '0.000005',
      },
      {
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        inputCostPerToken: '0.000001',
      },
    ]);
  });

  it('handles CRLF line endings and a BOM', () => {
    const rows = fromCsv('\uFEFFa,b\r\n1,2\r\n3,4\r\n');
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('handles quoted cells with embedded commas + escaped quotes', () => {
    const rows = fromCsv('a,b,c\n' + '"comma, here","she said ""hi""",plain\n');
    expect(rows).toEqual([
      { a: 'comma, here', b: 'she said "hi"', c: 'plain' },
    ]);
  });

  it('round-trips through toCsv → fromCsv', () => {
    const source = [
      { provider: 'openai', model: 'gpt-4o', cost: '0.000005' },
      { provider: 'anthropic', model: 'claude, weird "name"', cost: '0.0001' },
    ];
    const round = fromCsv(toCsv(source, ['provider', 'model', 'cost']));
    expect(round).toEqual(source);
  });

  it('throws on empty input', () => {
    expect(() => fromCsv('')).toThrow(/empty/i);
    expect(() => fromCsv('   ')).toThrow(/empty/i);
  });

  it('throws on an unterminated quoted cell', () => {
    expect(() => fromCsv('a,b\n"unterminated,foo\n')).toThrow(/unterminated/i);
  });

  it('throws when a row has a different column count than the header', () => {
    expect(() => fromCsv('a,b,c\n1,2\n')).toThrow(
      /row 2 has 2 column\(s\), expected 3/i
    );
  });

  it('tolerates a trailing blank line', () => {
    const rows = fromCsv('a,b\n1,2\n\n');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });
});
