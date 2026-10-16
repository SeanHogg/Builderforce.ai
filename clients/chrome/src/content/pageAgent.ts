/**
 * Rovr's PAGE AGENT — the content script the run host injects into an ALLOWED tab
 * (`chrome.scripting.executeScript`, never declared for every site in the manifest).
 *
 * It does exactly what the protocol (`page/pageProtocol.ts`) asks and nothing else: read
 * the page, find elements, click, type, scroll, wait. It hands out short REFS for the
 * elements it reports and resolves later requests through them, and it MEASURES the facts
 * the safety gate classifies on (password / payment fields, form submission) from the
 * markup itself.
 *
 * It answers only messages from its own extension, and it never acts on its own.
 */
import { PAGE_CHANNEL, type ElementFacts, type PageEnvelope, type PageReadResult, type PageRequest, type PageResponse } from '../page/pageProtocol';

declare global {
  interface Window {
    __rovrPageAgent?: boolean;
  }
}

const INTERACTIVE =
  'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=switch], [role=combobox], [role=textbox], [contenteditable=""], [contenteditable=true]';
const MAX_ELEMENTS = 200;
const NAME_MAX = 120;

const refs = new Map<string, WeakRef<Element>>();
const refOf = new WeakMap<Element, string>();
let nextRef = 1;

function refFor(el: Element): string {
  let ref = refOf.get(el);
  if (!ref) {
    ref = `e${nextRef++}`;
    refOf.set(el, ref);
    refs.set(ref, new WeakRef(el));
  }
  return ref;
}

function resolve(ref: string): Element | null {
  const el = refs.get(ref)?.deref() ?? null;
  return el && el.isConnected ? el : null;
}

const clean = (text: string | null | undefined, max = NAME_MAX): string => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function labelText(el: Element): string {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    if (clean(text)) return text;
  }
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent && clean(label.textContent)) return label.textContent;
  }
  const wrapping = el.closest('label');
  return wrapping?.textContent ?? '';
}

function accessibleName(el: Element): string {
  const input = el as HTMLInputElement;
  return clean(
    el.getAttribute('aria-label') ||
      labelText(el) ||
      (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(input.type) ? input.value : '') ||
      (el as HTMLElement).innerText ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      '',
  );
}

function implicitRole(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button' || tag === 'summary') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'checkbox' || type === 'radio') return type;
    return 'textbox';
  }
  return (el as HTMLElement).isContentEditable ? 'textbox' : '';
}

function submitsForm(el: Element): boolean {
  if (el instanceof HTMLButtonElement) return !!el.form && (el.type === 'submit' || !el.getAttribute('type'));
  if (el instanceof HTMLInputElement) return !!el.form && (el.type === 'submit' || el.type === 'image');
  return false;
}

function factsOf(el: Element): ElementFacts {
  const input = el instanceof HTMLInputElement ? el : null;
  const disabled = (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
  return {
    ref: refFor(el),
    tag: el.tagName.toLowerCase(),
    role: implicitRole(el),
    name: accessibleName(el),
    inputType: input ? input.type.toLowerCase() : '',
    autocomplete: (el.getAttribute('autocomplete') ?? '').toLowerCase(),
    fieldName: `${el.getAttribute('name') ?? ''} ${el.id ?? ''}`.trim().toLowerCase(),
    submitsForm: submitsForm(el),
    href: el instanceof HTMLAnchorElement ? el.href : '',
    inert: disabled || !isVisible(el),
  };
}

function interactiveElements(): Element[] {
  return [...document.querySelectorAll(INTERACTIVE)].filter(isVisible).slice(0, MAX_ELEMENTS);
}

function read(req: Extract<PageRequest, { op: 'read' }>): PageReadResult {
  const full = document.body?.innerText ?? '';
  return {
    title: document.title,
    url: location.href,
    text: full.slice(0, req.maxChars),
    selection: clean(window.getSelection()?.toString() ?? '', 4000),
    truncated: full.length > req.maxChars,
    elements: req.includeElements ? interactiveElements().map(factsOf) : [],
  };
}

function find(query: string, limit: number): ElementFacts[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored = interactiveElements()
    .map((el) => {
      const facts = factsOf(el);
      const hay = `${facts.name} ${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('title') ?? ''} ${facts.fieldName}`.toLowerCase();
      const score = words.filter((w) => hay.includes(w)).length;
      return { facts, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.facts);
}

/** Set a field's value the way a person typing would — frameworks see the change. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function pressEnter(el: Element): void {
  for (const type of ['keydown', 'keypress', 'keyup']) {
    el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }
  const form = (el as HTMLInputElement).form;
  if (form) form.requestSubmit();
}

function type(el: Element, text: string, submit: boolean): string {
  (el as HTMLElement).focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) setValue(el, text);
  else if (el instanceof HTMLSelectElement) {
    const option = [...el.options].find((o) => o.value === text || clean(o.textContent) === text);
    if (!option) throw new Error(`No option "${text}" in this list.`);
    el.value = option.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if ((el as HTMLElement).isContentEditable) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  } else throw new Error('That element does not take text.');
  if (submit) pressEnter(el);
  return 'typed';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(forText: string | undefined, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  if (!forText) {
    await sleep(Math.min(timeoutMs, 3000));
    return 'waited';
  }
  const needle = forText.toLowerCase();
  while (Date.now() < deadline) {
    if ((document.body?.innerText ?? '').toLowerCase().includes(needle)) return `found "${forText}"`;
    await sleep(250);
  }
  throw new Error(`"${forText}" did not appear within ${Math.round(timeoutMs / 1000)}s.`);
}

async function handle(req: PageRequest): Promise<PageResponse> {
  switch (req.op) {
    case 'read':
      return { ok: true, read: read(req) };
    case 'find':
      return { ok: true, elements: find(req.query, req.limit) };
    case 'describe': {
      const el = resolve(req.ref);
      return el ? { ok: true, element: factsOf(el) } : { ok: false, error: `Element ${req.ref} is no longer on the page — read or find it again.` };
    }
    case 'click': {
      const el = resolve(req.ref);
      if (!el) return { ok: false, error: `Element ${req.ref} is no longer on the page — read or find it again.` };
      el.scrollIntoView({ block: 'center' });
      (el as HTMLElement).focus?.();
      (el as HTMLElement).click();
      return { ok: true, done: 'clicked' };
    }
    case 'type': {
      const el = resolve(req.ref);
      if (!el) return { ok: false, error: `Element ${req.ref} is no longer on the page — read or find it again.` };
      el.scrollIntoView({ block: 'center' });
      return { ok: true, done: type(el, req.text, req.submit) };
    }
    case 'scroll': {
      if (req.ref) {
        const el = resolve(req.ref);
        if (!el) return { ok: false, error: `Element ${req.ref} is no longer on the page.` };
        el.scrollIntoView({ block: 'center' });
        return { ok: true, done: 'scrolled into view' };
      }
      if (req.direction === 'top') window.scrollTo({ top: 0 });
      else if (req.direction === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight });
      else window.scrollBy({ top: (req.direction === 'up' ? -1 : 1) * window.innerHeight * 0.8 });
      return { ok: true, done: `scrolled ${req.direction}` };
    }
    case 'wait':
      return { ok: true, done: await waitFor(req.forText, req.timeoutMs) };
  }
}

if (!window.__rovrPageAgent) {
  window.__rovrPageAgent = true;
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const envelope = message as PageEnvelope | undefined;
    if (sender.id !== chrome.runtime.id || envelope?.channel !== PAGE_CHANNEL) return false;
    handle(envelope.request)
      .then(sendResponse)
      .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies PageResponse));
    return true; // the answer is asynchronous
  });
}
