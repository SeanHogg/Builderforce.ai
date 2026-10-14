/**
 * THE visual patch (PRD 33 §5.2 "Render", D13/D14): a small, closed set of DOM
 * operations a page-review prescription may propose, validated BEFORE it is stored
 * and applied only in the runner's sandbox (`page_render_after`) to render the
 * "after" screenshot. Nothing here ever reaches a visitor.
 *
 *   setText      replace an element's text
 *   setAttr      alt | aria-label | title | placeholder | href (same-origin only)
 *   setStyle     layout / spacing / size / colour / visibility properties; a colour
 *                must already be in the page's own palette
 *   moveBefore   move an element before another
 *   moveAfter    move an element after another
 *   insertAfter  sanitised HTML (allow-listed tags, no `on*`, `style` through the
 *                same allow-list) after an element
 *   hide         `display: none`
 *
 * Every selector must name an element of the capture's rect map (the SAME
 * `deriveSelector` produced both), so a patch can only touch what the review saw.
 *
 * Structural types only (no DOM globals): the API Worker validates, the runner's
 * page kit applies against the real `document`, and the tests apply against a fake.
 */

import { deriveSelector, type SelectorElement } from './selector';
import {
  CONTROL_CHARS,
  isSameOriginHref,
  normaliseColour,
  sanitizePatchHtml,
  styleProblem,
  VISUAL_PATCH_LIMITS,
} from './visualPatchRules';

export {
  isSameOriginHref,
  normaliseColour,
  PATCH_COLOUR_PROPERTIES,
  PATCH_HTML_TAGS,
  PATCH_STYLE_PROPERTIES,
  sanitizePatchHtml,
  styleProblem,
  VISUAL_PATCH_LIMITS,
  type SanitisedHtml,
} from './visualPatchRules';

/** One element of a capture's rect map (`replay_page_captures.rect_map_key`). */
export interface PageRect {
  selector: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Accessible label; empty for an element inside a masked region. */
  label: string;
  /** `heading` | `cta` | `link` | `input` | `image` | `section`. */
  role: string;
}

export const PATCH_ATTRS = ['alt', 'aria-label', 'title', 'placeholder', 'href'] as const;
export type PatchAttr = (typeof PATCH_ATTRS)[number];

export type VisualPatchOp =
  | { op: 'setText'; selector: string; text: string }
  | { op: 'setAttr'; selector: string; name: PatchAttr; value: string }
  | { op: 'setStyle'; selector: string; property: string; value: string }
  | { op: 'moveBefore'; selector: string; anchor: string }
  | { op: 'moveAfter'; selector: string; anchor: string }
  | { op: 'insertAfter'; selector: string; html: string }
  | { op: 'hide'; selector: string };

export interface VisualPatch {
  ops: VisualPatchOp[];
}

export type VisualPatchValidation = { ok: true } | { ok: false; reason: string };

const OPS = new Set(['setText', 'setAttr', 'setStyle', 'moveBefore', 'moveAfter', 'insertAfter', 'hide']);

/** Validation context: the rect map's selectors, the palette, and the page origin for `href`. */
export interface PatchContext {
  selectors: ReadonlySet<string>;
  palette: ReadonlySet<string>;
  origin?: string | null;
}

function opProblem(raw: unknown, ctx: PatchContext): string | null {
  if (!raw || typeof raw !== 'object') return 'an op is not an object';
  const op = raw as Record<string, unknown>;
  if (typeof op.op !== 'string' || !OPS.has(op.op)) return `unknown op "${String(op.op)}"`;
  if (typeof op.selector !== 'string' || !ctx.selectors.has(op.selector)) return `unknown selector "${String(op.selector)}"`;
  switch (op.op) {
    case 'setText':
      if (typeof op.text !== 'string' || op.text.length > VISUAL_PATCH_LIMITS.maxText || CONTROL_CHARS.test(op.text)) return 'setText needs a short plain text';
      if (/<\s*\/?\s*[a-z!?]/i.test(op.text)) return 'setText may not carry markup';
      return null;
    case 'setAttr': {
      if (typeof op.name !== 'string' || !(PATCH_ATTRS as readonly string[]).includes(op.name)) return `attribute "${String(op.name)}" is not allowed`;
      if (typeof op.value !== 'string' || op.value.length > VISUAL_PATCH_LIMITS.maxAttr || CONTROL_CHARS.test(op.value)) return 'setAttr needs a short value';
      if (op.name === 'href' && !isSameOriginHref(op.value, ctx.origin)) return 'href must stay on this site';
      return null;
    }
    case 'setStyle':
      if (typeof op.property !== 'string' || typeof op.value !== 'string') return 'setStyle needs a property and a value';
      return styleProblem(op.property, op.value, ctx.palette);
    case 'moveBefore':
    case 'moveAfter':
      if (typeof op.anchor !== 'string' || !ctx.selectors.has(op.anchor)) return `unknown anchor "${String(op.anchor)}"`;
      if (op.anchor === op.selector) return 'an element cannot move next to itself';
      return null;
    case 'insertAfter': {
      if (typeof op.html !== 'string' || op.html.length > VISUAL_PATCH_LIMITS.maxHtml) return 'insertAfter needs short HTML';
      const clean = sanitizePatchHtml(op.html, { palette: ctx.palette, origin: ctx.origin ?? null });
      return clean.ok ? null : clean.reason;
    }
    case 'hide':
      return null;
    default:
      return `unknown op "${String(op.op)}"`;
  }
}

/**
 * Validate a patch against the capture's rect map and the page's palette. Rejects
 * scripts and markup outside the allow-list, external URLs, unknown selectors and
 * disallowed properties — the first problem found is the reason.
 */
export function validateVisualPatch(
  patch: unknown,
  rectMap: ReadonlyArray<Pick<PageRect, 'selector'>>,
  palette: readonly string[],
  opts: { origin?: string | null } = {},
): VisualPatchValidation {
  if (!patch || typeof patch !== 'object' || !Array.isArray((patch as { ops?: unknown }).ops)) return { ok: false, reason: 'a patch is { ops: [...] }' };
  const ops = (patch as { ops: unknown[] }).ops;
  if (ops.length === 0) return { ok: false, reason: 'a patch needs at least one op' };
  if (ops.length > VISUAL_PATCH_LIMITS.maxOps) return { ok: false, reason: `a patch has at most ${VISUAL_PATCH_LIMITS.maxOps} ops` };
  const ctx: PatchContext = {
    selectors: new Set(rectMap.map((r) => r.selector)),
    palette: new Set(palette.map(normaliseColour)),
    origin: opts.origin ?? null,
  };
  for (const op of ops) {
    const problem = opProblem(op, ctx);
    if (problem) return { ok: false, reason: problem };
  }
  return { ok: true };
}

/** The numbered callouts of a patch: each distinct element it touches, in op order. */
export function patchCallouts(patch: VisualPatch): Array<{ n: number; selector: string }> {
  const seen: string[] = [];
  for (const op of patch.ops) if (!seen.includes(op.selector)) seen.push(op.selector);
  return seen.map((selector, i) => ({ n: i + 1, selector }));
}

// ── Applying (the runner's sandbox page; a fake document in tests) ────────────

/** The slice of a DOM `HTMLElement` the patch writes. A real element satisfies it. */
export interface PatchElement extends SelectorElement {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  readonly style: { setProperty(property: string, value: string): void };
  before(...nodes: PatchElement[]): void;
  after(...nodes: PatchElement[]): void;
  insertAdjacentHTML(position: 'afterend', html: string): void;
}

/** The slice of a DOM `Document` the patch reads. */
export interface PatchDocument {
  querySelectorAll(selectors: string): ArrayLike<PatchElement>;
}

/** Every element of the document by its derived selector (first occurrence wins). */
export function selectorIndex(doc: PatchDocument): Map<string, PatchElement> {
  const index = new Map<string, PatchElement>();
  const all = doc.querySelectorAll('body *');
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    const { selector } = deriveSelector(el);
    if (!index.has(selector)) index.set(selector, el);
  }
  return index;
}

/**
 * Apply a VALIDATED patch to a document. Selectors are resolved once, before any op
 * runs, so a text change cannot re-name the element a later op means. An op whose
 * element is missing is skipped and reported; inserted HTML is re-sanitised
 * structurally (tags/attributes) as a second line of defence.
 */
export function applyVisualPatch(
  doc: PatchDocument,
  patch: VisualPatch,
  opts: { origin?: string | null } = {},
): { applied: number; skipped: string[] } {
  const index = selectorIndex(doc);
  const skipped: string[] = [];
  let applied = 0;
  for (const op of patch.ops) {
    const el = index.get(op.selector);
    if (!el) {
      skipped.push(op.selector);
      continue;
    }
    switch (op.op) {
      case 'setText':
        el.textContent = op.text;
        break;
      case 'setAttr':
        el.setAttribute(op.name, op.value);
        break;
      case 'setStyle':
        el.style.setProperty(op.property.trim().toLowerCase(), op.value.trim());
        break;
      case 'hide':
        el.style.setProperty('display', 'none');
        break;
      case 'moveBefore':
      case 'moveAfter': {
        const anchor = index.get(op.anchor);
        if (!anchor) {
          skipped.push(op.anchor);
          continue;
        }
        if (op.op === 'moveBefore') anchor.before(el);
        else anchor.after(el);
        break;
      }
      case 'insertAfter': {
        const clean = sanitizePatchHtml(op.html, { palette: null, origin: opts.origin ?? null });
        if (!clean.ok) {
          skipped.push(op.selector);
          continue;
        }
        el.insertAdjacentHTML('afterend', clean.html);
        break;
      }
    }
    applied += 1;
  }
  return { applied, skipped };
}
