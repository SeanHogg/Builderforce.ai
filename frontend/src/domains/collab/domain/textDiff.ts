/**
 * The minimal prefix/suffix diff between two strings.
 *
 * A `<textarea>` reports its whole value on every keystroke; a CRDT needs the
 * EDIT. Replacing the whole sequence instead would delete and re-insert every
 * character, which reads as "one person overwrote the document" to anybody else
 * in the room and destroys their caret and every offset anchored to it.
 *
 * Deliberately not a real diff. Prefix/suffix is exact for the only thing a
 * textarea can do in one event — one contiguous replacement — and a longest-common
 * -subsequence pass would cost more than it buys for that shape.
 */
export interface TextEdit {
  /** Index at which the change starts. */
  at: number;
  /** How many characters to delete there. */
  remove: number;
  /** What to insert in their place. */
  insert: string;
}

/** `null` when the strings are equal — nothing to apply, and no transaction to open. */
export function diffText(before: string, after: string): TextEdit | null {
  if (before === after) return null;
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  return { at: start, remove: endBefore - start, insert: after.slice(start, endAfter) };
}
