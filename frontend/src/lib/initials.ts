/**
 * Initials for an avatar or a chip, from a display name. ONE rule for every surface:
 * first and last word, two letters of a single word, a placeholder for no name.
 * "John Doe" → "JD", "Alice" → "AL", "" → "?".
 */
export function initialsOf(name: string | null | undefined, placeholder = '?'): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return placeholder;
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
