/**
 * Render a finite number as a plain decimal string with no
 * exponential notation and no trailing zeros. JS's default
 * `Number.prototype.toString()` flips to exponential below ~1e-6
 * (e.g. `(3e-7).toString() === '3e-7'`), which is unfriendly for
 * per-token pricing values that routinely land in the 1e-7 to 1e-10
 * range. This helper keeps them in `0.000…` form.
 *
 *   formatPlainDecimal(0.0000003) === '0.0000003'   // not '3e-7'
 *   formatPlainDecimal(5e-6)      === '0.000005'
 *   formatPlainDecimal(1.5)       === '1.5'
 *   formatPlainDecimal(0)         === '0'
 *
 * Mirrors the server-side `formatPlainDecimal` in
 * `packages/api/src/model-pricing/csv-codec.ts` — kept in sync by
 * hand because the two packages don't share a runtime.
 */
export function formatPlainDecimal(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n === 0) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + abs.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}
