/**
 * Cheap, stable string hash (djb2). For change detection only — "is this the text I saw
 * last time" — never for anything a collision could make unsafe.
 */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}
