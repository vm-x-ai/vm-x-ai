/**
 * Minimal CSV codec used by the model-pricing import/export endpoints.
 *
 * The pricing table is well-structured: short ASCII identifiers and
 * numeric costs, no embedded commas/quotes/newlines in cell values
 * under any normal use. So we lean on a hand-rolled encoder/parser
 * instead of pulling in `papaparse` / `csv-stringify` and their
 * transitive deps — but the parser still handles RFC-4180 double-quote
 * escaping for the case where someone hand-edits a file and uses a
 * comma inside a quoted value.
 *
 * Both functions stay format-agnostic about which columns exist —
 * pass the header set you care about. The caller validates the
 * resulting field map; we just shape the rows.
 */

const EOL = '\n';

/**
 * Serialize an array of row objects to CSV. Columns are listed in the
 * provided order. Cell values are coerced to strings (with `''` for
 * null/undefined) and quoted only when necessary (RFC-4180 minimal
 * quoting: commas, double-quotes, and newlines force a quoted value).
 *
 * Numbers are formatted as plain decimals (no exponential notation) so
 * an exported file is readable in a spreadsheet or text editor. JS's
 * default `Number.prototype.toString()` flips to exponential below
 * ~1e-6 (e.g. `(3e-7).toString() === '3e-7'`), which is unfriendly for
 * per-token pricing values that routinely land in the 1e-7 to 1e-10
 * range. `formatPlainDecimal` keeps them in `0.000…` form.
 */
export function toCsv<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly (keyof T & string)[]
): string {
  const header = columns.map(escapeCell).join(',');
  const body = rows.map((row) =>
    columns
      .map((col) => {
        const v = row[col];
        if (v == null) return '';
        if (typeof v === 'number') return escapeCell(formatPlainDecimal(v));
        return escapeCell(String(v));
      })
      .join(',')
  );
  return [header, ...body].join(EOL) + EOL;
}

function escapeCell(value: string): string {
  if (value.includes(',') || value.includes('"') || /[\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Render a finite number as a plain decimal string with no
 * exponential notation and no trailing zeros. Used by the CSV
 * serializer; exported so the same formatting can be reused by the
 * UI's display layer.
 *
 *   formatPlainDecimal(0.0000003) === '0.0000003'   // not '3e-7'
 *   formatPlainDecimal(5e-6)      === '0.000005'
 *   formatPlainDecimal(1.5)       === '1.5'
 *   formatPlainDecimal(0)         === '0'
 *
 * Non-finite values (NaN / ±Infinity) fall back to JS's default
 * stringification, which is fine for diagnostic / error paths.
 */
export function formatPlainDecimal(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return '0';
  // 20 fractional digits comfortably covers the 1e-12-ish smallest
  // per-token costs we'll ever see. Strip trailing zeros and a
  // dangling decimal point so the output stays clean.
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + abs.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Parse a CSV string into an array of objects keyed by the header row.
 *
 * Handles:
 *   - LF or CRLF line endings
 *   - Quoted cells (RFC-4180 minimal: `"a, b"`, `"she said ""hi"""`)
 *   - Trailing newline
 *   - Empty cells (yield empty strings; numeric coercion is the caller's job)
 *
 * Throws on:
 *   - Empty input
 *   - Unterminated quote
 *   - Row with a different column count than the header
 */
export function fromCsv(input: string): Record<string, string>[] {
  const text = input.replace(/^\uFEFF/, ''); // strip BOM if present
  if (!text.trim()) {
    throw new Error('CSV input is empty');
  }
  const rows = splitRows(text);
  if (rows.length < 1) {
    throw new Error('CSV input has no rows');
  }
  const header = rows[0];
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0] === '') continue; // tolerate trailing blank line
    if (row.length !== header.length) {
      throw new Error(
        `CSV row ${i + 1} has ${row.length} column(s), expected ${
          header.length
        }`
      );
    }
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = row[c];
    }
    out.push(obj);
  }
  return out;
}

function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // swallow — handled with the LF that follows (or a lone CR)
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (inQuotes) {
    throw new Error('CSV input has an unterminated quoted cell');
  }
  // Flush a partial trailing row when the file didn't end with EOL.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
