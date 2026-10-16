/**
 * The contract between Rovr's run host (side panel) and its page agent (the content
 * script injected into an ALLOWED tab). Requests name elements by REF — a short id the
 * page agent assigns when it reads or finds them — never by a selector the model made
 * up, so every act targets something the model was actually shown.
 *
 * Every element description carries the FACTS the safety gate classifies on (`safety.ts`):
 * what kind of control it is, whether it submits a form, whether it is a password or
 * payment field. They are measured by the page agent, not inferred from model text.
 */

/** What the safety gate needs to know about one element. */
export interface ElementFacts {
  ref: string;
  /** Lower-case tag name (`button`, `input`, `a`, …). */
  tag: string;
  /** ARIA role (explicit or implicit), when there is one. */
  role: string;
  /** Visible text / accessible name, trimmed and capped. */
  name: string;
  /** `input` type, lower-case (`text`, `password`, `submit`, …), or ''. */
  inputType: string;
  /** The `autocomplete` token(s), lower-case, or ''. */
  autocomplete: string;
  /** `name` / `id` attributes, lower-case, joined — what a field is called in markup. */
  fieldName: string;
  /** Activating it submits a form (a submit button, or Enter in a form field). */
  submitsForm: boolean;
  /** Link target, for an anchor. */
  href: string;
  /** Disabled or hidden — acting on it would do nothing. */
  inert: boolean;
}

export type PageRequest =
  | { op: 'read'; maxChars: number; includeElements: boolean }
  | { op: 'find'; query: string; limit: number }
  | { op: 'describe'; ref: string }
  | { op: 'click'; ref: string }
  | { op: 'type'; ref: string; text: string; submit: boolean }
  | { op: 'scroll'; direction: 'up' | 'down' | 'top' | 'bottom'; ref?: string }
  | { op: 'wait'; forText?: string; timeoutMs: number };

export interface PageReadResult {
  title: string;
  url: string;
  text: string;
  selection: string;
  truncated: boolean;
  elements: ElementFacts[];
}

export type PageResponse =
  | { ok: true; read: PageReadResult }
  | { ok: true; elements: ElementFacts[] }
  | { ok: true; element: ElementFacts }
  | { ok: true; done: string }
  | { ok: false; error: string };

/** The envelope on `chrome.tabs.sendMessage`, so the page agent ignores anything else. */
export const PAGE_CHANNEL = 'rovr.page';
export interface PageEnvelope {
  channel: typeof PAGE_CHANNEL;
  request: PageRequest;
}
