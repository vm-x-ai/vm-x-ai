export function numberWithCommas(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format a USD-denominated cost with adaptive precision.
 *
 * Per-request LLM costs span ~6 orders of magnitude — a one-token Haiku call
 * costs ~$0.000001 while a long-context o1 call can be several dollars. A
 * fixed precision either drops detail or shouts noise, so:
 *
 * - `>= 1` USD → 2 decimals ($1.23)
 * - `>= 0.01` → 4 decimals ($0.0123)
 * - smaller     → 6 decimals ($0.001234)
 * - exact zero  → "$0"
 *
 * Uses Intl.NumberFormat for locale-correct grouping.
 */
export function formatCurrency(value: number, currency = 'USD'): string {
  if (!Number.isFinite(value) || value === 0) {
    return value === 0 ? '$0' : '-';
  }
  const abs = Math.abs(value);
  const fractionDigits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}
