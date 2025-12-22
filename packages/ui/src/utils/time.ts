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
