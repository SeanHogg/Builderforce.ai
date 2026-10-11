/**
 * THE selector derivation — one rule for every surface that names an element.
 *
 * Moved verbatim from `frontend/src/lib/qa/telemetry.ts`, which now imports it
 * back. The QA telemetry, the session-replay recorder (clicks, heatmap cells,
 * frustration marks) and the page-review runner all name an element the same
 * way, so a selector captured by one is a selector the others can find.
 *
 * Stable-first: data-testid → role + accessible name → text → a short css path.
 * The output is a Playwright-style locator string, which is what the QA
 * generator turns into tests.
 *
 * The parameter is STRUCTURAL (`SelectorElement`) rather than the DOM `Element`
 * so this file compiles under the API Worker's lib as well as the browser's: a
 * DOM `Element` satisfies it, and nothing here touches a DOM global.
 */

/** The slice of a DOM `Element` the selector rule reads. A real `Element` satisfies it. */
export interface SelectorElement {
  readonly tagName: string;
  readonly id: string;
  readonly nodeType: number;
  readonly textContent: string | null;
  readonly parentElement: SelectorElement | null;
  getAttribute(qualifiedName: string): string | null;
}

/** Accessible name for an element: aria-label → trimmed text → title/placeholder. */
function accessibleName(el: SelectorElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim().slice(0, 120);
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 120);
  const title = el.getAttribute('title') ?? el.getAttribute('placeholder');
  return (title ?? '').trim().slice(0, 120);
}

/** Short, mostly-stable css path as a last resort. */
function cssPath(el: SelectorElement): string {
  const parts: string[] = [];
  let node: SelectorElement | null = el;
  let depth = 0;
  while (node && depth < 4 && node.nodeType === 1) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += `#${node.id}`;
      parts.unshift(part);
      break;
    }
    const cls = (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)[0];
    if (cls) part += `.${cls}`;
    parts.unshift(part);
    node = node.parentElement;
    depth++;
  }
  return parts.join(' > ').slice(0, 400);
}

/**
 * Derive a stable selector for an element, preferring locators Playwright can
 * reproduce. Returns a Playwright-style locator string.
 */
export function deriveSelector(el: SelectorElement): { selector: string; label: string } {
  const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test-id');
  if (testId) return { selector: `getByTestId(${JSON.stringify(testId)})`, label: testId };

  const role = el.getAttribute('role') ?? implicitRole(el);
  const name = accessibleName(el);
  if (role && name) return { selector: `getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)} })`, label: name };
  if (name) return { selector: `getByText(${JSON.stringify(name)})`, label: name };

  return { selector: cssPath(el), label: el.tagName.toLowerCase() };
}

/**
 * The ARIA role an element has without a `role` attribute, for the tags the
 * selector rule cares about. Exported because the dead-click detector asks the
 * same question ("is this interactive?") and must not keep its own tag list.
 */
export function implicitRole(el: Pick<SelectorElement, 'tagName' | 'getAttribute'>): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'submit' || type === 'button') return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'textbox';
  }
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  return null;
}

/**
 * The slice of an `<input>` / `<textarea>` the redactor reads. A real
 * `HTMLInputElement` / `HTMLTextAreaElement` satisfies it; nothing here
 * touches a DOM global.
 */
export interface RedactableInput {
  getAttribute(qualifiedName: string): string | null;
  readonly value: string;
}

/**
 * Redacted descriptor for an input — NEVER the raw value. Password fields
 * return null so the caller skips the event entirely.
 */
export function redactInput(el: RedactableInput): string | null {
  const type = (el.getAttribute('type') ?? 'text').toLowerCase();
  if (type === 'password') return null;
  const name = el.getAttribute('name') ?? el.getAttribute('id') ?? type;
  const len = (el.value ?? '').length;
  return `${name}:${type}:len${len}`.slice(0, 120);
}
