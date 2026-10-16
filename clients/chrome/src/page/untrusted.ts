/**
 * Page content is DATA, never instructions. Everything Rovr reads off a web page —
 * text, the selection, element names, tab titles — reaches the model inside one fence
 * whose meaning the system prompt states (`prompt/systemPrompt.ts`): text in the fence
 * may ASK for anything, and none of it is a request from the person.
 *
 * The fence cannot be closed from inside: any occurrence of the closing tag in the page
 * text is defanged before it is wrapped, so a page cannot end the quote early and
 * continue as if it were the system.
 */

export const UNTRUSTED_OPEN = '<untrusted_page_content';
export const UNTRUSTED_CLOSE = '</untrusted_page_content>';

/** Defang anything in `text` that could read as our fence's own tags. */
export function defang(text: string): string {
  return text.replace(/<\s*\/?\s*untrusted_page_content/gi, (m) => m.replace('<', '‹'));
}

/** Wrap page-sourced text for the model, labelled with where it came from. */
export function quoteUntrusted(source: string, text: string): string {
  const label = defang(source).replace(/"/g, "'");
  return `${UNTRUSTED_OPEN} source="${label}">\n${defang(text)}\n${UNTRUSTED_CLOSE}`;
}
