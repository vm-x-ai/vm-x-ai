export function humanFileSize(size: number, si = false, dp = 1) {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(size) < thresh) {
    return size + ' B';
  }

  const units = si
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10 ** dp;

  do {
    size /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(size) * r) / r >= thresh &&
    u < units.length - 1
  );

  return size.toFixed(dp) + ' ' + units[u];
}

export function bytesToHumanReadable(value: number): string {
  if (value < 1024) {
    return `${value}B`;
  } else if (value < 1048576) {
    return `${(value / 1024).toFixed(2)}KB`;
  } else if (value < 1073741824) {
    return `${(value / 1048576).toFixed(2)}MB`;
  } else {
    return `${(value / 1073741824).toFixed(2)}GB`;
  }
}
