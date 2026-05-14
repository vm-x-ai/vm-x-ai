/**
 * Compact latency formatter for per-request cells. Returns `—` for
 * null/undefined/non-finite, sub-millisecond values with two decimals,
 * sub-second values rounded to ms, and seconds with two decimals.
 * Distinct from `formatDuration` below, which emits a multi-segment
 * `"01h 02m 03s 4ms"` clock format that's too heavy for a per-request
 * latency cell.
 */
export function formatLatency(ms: number | undefined | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatDuration(duration: number): string {
  const milliseconds = Math.floor((duration % 1000) / 100);
  const seconds = Math.floor((duration / 1000) % 60);
  const minutes = Math.floor((duration / (1000 * 60)) % 60);
  const hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

  const hoursStr = hours < 10 ? '0' + hours : hours;
  const minutesStr = minutes < 10 ? '0' + minutes : minutes;
  const secondsStr = seconds < 10 ? '0' + seconds : seconds;

  if (hours > 0) {
    return `${hoursStr}h ${minutesStr}m ${secondsStr}s ${milliseconds}ms`;
  } else if (minutes > 0) {
    return `${minutesStr}m ${secondsStr}s ${milliseconds}ms`;
  } else if (seconds > 0) {
    return `${secondsStr}s ${milliseconds}ms`;
  } else {
    return `${milliseconds}ms`;
  }
}

export function toUtc(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
      value.getMilliseconds()
    )
  );
}
