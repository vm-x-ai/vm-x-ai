function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

export function stringToColor(string: string) {
  const c: string = (hashCode(string) & 0x00ffffff).toString(16).toUpperCase();
  const hex = '00000'.substring(0, 6 - c.length) + c;
  return `#${hex}`;
}
