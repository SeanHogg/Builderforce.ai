/**
 * Whether a keystroke belongs to whoever is typing, rather than to a shortcut.
 *
 * Every global `keydown` listener in the product has to answer the same question
 * before it acts: is the person writing into a field right now? A board that deletes
 * the selected object because you pressed Backspace in the prompt, or a walker that
 * strides forward because you typed a `w`, is the same bug written twice — and it was
 * written three times, each with its own idea of what counts as a field (one checked
 * `INPUT`/`TEXTAREA` by tag, another added `SELECT` by instance, none checked
 * `contenteditable`, which is what the rich-text objects are).
 *
 * One gate, so a shortcut that stands down stands down everywhere, and a field that
 * gets added is protected everywhere at once.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}
