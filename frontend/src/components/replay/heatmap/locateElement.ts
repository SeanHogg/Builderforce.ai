/**
 * Find the element a stored selector names, inside a rebuilt page (the
 * heatmap background's sandboxed iframe document).
 *
 * Selectors come from THE selector derivation (`deriveSelector`, PRD 33 §6
 * "one selector derivation"): Playwright-style `getByTestId(…)`,
 * `getByRole(…, { name })`, `getByText(…)`, else a short css path. Rather
 * than a second parser of what a role or a name means, a candidate is
 * accepted only when `deriveSelector(candidate)` gives back the SAME string —
 * so this can never disagree with the recorder.
 */

import { deriveSelector } from '@builderforce/interaction-contract';

/** Text nodes probed for a role/text selector — a ceiling for very large pages. */
const MAX_TEXT_NODES = 20_000;
/** How far up from a matching text node a named element may sit. */
const MAX_CLIMB = 6;

function jsonString(raw: string): string | null {
  try {
    const value: unknown = JSON.parse(raw.trim());
    return typeof value === 'string' ? value : null;
  } catch (error) {
    void error;
    return null;
  }
}

/** The accessible name a `getByRole` / `getByText` selector carries. */
function nameOf(how: string, args: string): string | null {
  if (how === 'Text') return jsonString(args);
  const role = /^\s*"(?:[^"\\]|\\.)*"\s*,\s*\{\s*name:\s*("(?:[^"\\]|\\.)*")\s*\}\s*$/.exec(args);
  return role ? jsonString(role[1]!) : null;
}

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();

export function locateElement(doc: Document, selector: string): Element | null {
  const wanted = selector.trim();
  if (!wanted) return null;
  const call = /^getBy(TestId|Role|Text)\(([\s\S]*)\)$/.exec(wanted);

  if (!call) {
    try {
      return doc.querySelector(wanted);
    } catch (error) {
      void error; // not a valid css selector in this document
      return null;
    }
  }

  const [, how = '', args = ''] = call;
  if (how === 'TestId') {
    const id = jsonString(args);
    if (!id) return null;
    const quoted = JSON.stringify(id);
    try {
      return doc.querySelector(`[data-testid=${quoted}], [data-test-id=${quoted}]`);
    } catch (error) {
      void error;
      return null;
    }
  }

  const name = nameOf(how, args);
  if (!name) return null;
  const same = (el: Element) => deriveSelector(el).selector === wanted;

  // Named by an attribute (aria-label wins in the derivation, then title/placeholder).
  for (const el of Array.from(doc.querySelectorAll('[aria-label], [title], [placeholder]'))) {
    if (same(el)) return el;
  }

  // Named by its text: climb from each text node that holds part of the name.
  const root = doc.body ?? doc.documentElement;
  if (!root) return null;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let node = walker.nextNode(), count = 0; node && count < MAX_TEXT_NODES; node = walker.nextNode(), count += 1) {
    const text = normalise(node.textContent ?? '');
    if (!text || !name.includes(text.slice(0, 40))) continue;
    let el: Element | null = node.parentElement;
    for (let depth = 0; el && depth < MAX_CLIMB; depth += 1, el = el.parentElement) {
      if (seen.has(el)) break;
      seen.add(el);
      if (same(el)) return el;
    }
  }
  return null;
}

/** An element's box in page pixels (the rebuilt iframe is full height and unscrolled, so its viewport IS the page). */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function pageRectOf(el: Element): PageRect {
  const rect = el.getBoundingClientRect();
  const win = el.ownerDocument.defaultView;
  return {
    x: rect.left + (win?.scrollX ?? 0),
    y: rect.top + (win?.scrollY ?? 0),
    w: rect.width,
    h: rect.height,
  };
}
