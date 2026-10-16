/**
 * The SAFETY GATE — which browser actions Rovr may take on its own, and which wait for
 * the person to say yes in the side panel.
 *
 * Pure: it classifies a call from what the page agent MEASURED about the target element
 * (`ElementFacts`), the URL of the tab, and the person's allow list — never from what the
 * model claims about them. It answers the Brain loop's `needsConfirm` predicate, so a
 * risky call pauses on the loop's own approval card (one confirm flow for every surface),
 * and the panel names the reasons it shows from {@link SafetyReason}.
 *
 * Confirmation is required when an action would:
 *   - touch a site that is not on the allow list (read or act — Rovr has no access to a
 *     site until the person grants it, and the approval is that grant);
 *   - submit a form, buy something, send or publish a message, or delete something;
 *   - put text into a password, payment or identity field, or type something shaped like
 *     a card number anywhere;
 *   - act on an element Rovr has not looked at (fail closed — no facts, no autonomy).
 */
import type { ElementFacts } from '../page/pageProtocol';
import { BROWSER_TOOL, type BrowserToolName } from './toolNames';

export type SafetyReason =
  | 'site_not_allowed'
  | 'submit'
  | 'purchase'
  | 'send'
  | 'destructive'
  | 'sensitive_field'
  | 'unknown_element';

/** The facts a call is classified against. */
export interface SafetyContext {
  /** The tab the call acts on, or null when there is none. */
  url: string | null;
  /** Origins the person has allowed (`https://example.com`). */
  allowedOrigins: ReadonlySet<string>;
  /** What the page agent last measured about an element ref on that tab. */
  factsFor(ref: string): ElementFacts | undefined;
}

// Keyword lists cover the five locales the product ships, matched case-insensitively on
// the element's visible name. They widen the gate, never narrow it: a miss here still
// leaves the form-submit and sensitive-field checks, which read markup, not words.
const PURCHASE = /\b(buy|purchase|checkout|check out|place (your )?order|pay|payment|subscribe|donate|complete order|confirm order|kaufen|bestellen|bezahlen|zahlungspflichtig|comprar|pagar|finalizar compra|acheter|payer|commander)\b|购买|支付|下单|付款|结账/i;
const SEND = /\b(send|post|publish|reply|tweet|share|comment|submit|senden|absenden|veröffentlichen|antworten|enviar|publicar|responder|envoyer|publier|répondre)\b|发送|发布|回复|提交/i;
const DESTRUCTIVE = /\b(delete|remove|erase|unsubscribe|cancel (my )?(account|subscription)|close account|löschen|entfernen|eliminar|borrar|supprimer)\b|删除|移除/i;
const SENSITIVE_AUTOCOMPLETE = /\b(cc-[a-z-]+|current-password|new-password|one-time-code|transaction-[a-z]+)\b/;
const SENSITIVE_FIELD = /(passw|passcode|pwd|\bpin\b|otp|card.?(num|no)|cardnumber|\bcc-?(num|number|csc|cvc)\b|cvv|cvc|csc|security.?code|iban|routing|account.?(num|no)|\bssn\b|social.?security|tax.?id|kontonummer|kreditkarte|tarjeta|carte.?bancaire)/i;

/** The page-reading and page-acting tools — every one needs the site on the allow list. */
const PAGE_TOOLS: ReadonlySet<BrowserToolName> = new Set([
  BROWSER_TOOL.read,
  BROWSER_TOOL.find,
  BROWSER_TOOL.click,
  BROWSER_TOOL.type,
  BROWSER_TOOL.scroll,
  BROWSER_TOOL.wait,
  BROWSER_TOOL.screenshot,
]);

/** `https://example.com` for a URL, or null for anything that is not http(s). */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** A run of 13–19 digits (spaces/dashes allowed) that passes the Luhn check. */
export function looksLikeCardNumber(text: string): boolean {
  for (const match of text.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

export function isSensitiveField(facts: ElementFacts): boolean {
  return (
    facts.inputType === 'password' ||
    SENSITIVE_AUTOCOMPLETE.test(facts.autocomplete) ||
    SENSITIVE_FIELD.test(facts.fieldName) ||
    SENSITIVE_FIELD.test(facts.name)
  );
}

/** What activating an element would do, read from its measured facts. */
function activationReasons(facts: ElementFacts): SafetyReason[] {
  const reasons: SafetyReason[] = [];
  if (facts.submitsForm) reasons.push('submit');
  if (PURCHASE.test(facts.name)) reasons.push('purchase');
  if (SEND.test(facts.name)) reasons.push('send');
  if (DESTRUCTIVE.test(facts.name)) reasons.push('destructive');
  return reasons;
}

const argString = (args: unknown, key: string): string => {
  const v = args && typeof args === 'object' ? (args as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' ? v : '';
};

/**
 * Every reason this call needs the person's confirmation — empty means Rovr may go
 * ahead. Unknown tools are not this gate's to judge (they are not browser tools).
 */
export function classifyAction(name: string, args: unknown, ctx: SafetyContext): SafetyReason[] {
  const reasons = new Set<SafetyReason>();
  const tool = name as BrowserToolName;

  if (tool === BROWSER_TOOL.navigate) {
    const target = originOf(argString(args, 'url'));
    if (!target || !ctx.allowedOrigins.has(target)) reasons.add('site_not_allowed');
    return [...reasons];
  }
  if (!PAGE_TOOLS.has(tool)) return [];

  const origin = originOf(ctx.url);
  if (!origin || !ctx.allowedOrigins.has(origin)) reasons.add('site_not_allowed');

  if (tool === BROWSER_TOOL.click || tool === BROWSER_TOOL.type) {
    const ref = argString(args, 'ref');
    const facts = ref ? ctx.factsFor(ref) : undefined;
    if (!facts) {
      reasons.add('unknown_element');
    } else if (tool === BROWSER_TOOL.click) {
      for (const r of activationReasons(facts)) reasons.add(r);
    } else {
      if (isSensitiveField(facts)) reasons.add('sensitive_field');
      const submit = args && typeof args === 'object' && (args as { submit?: unknown }).submit === true;
      if (submit) reasons.add('submit');
    }
    if (tool === BROWSER_TOOL.type && looksLikeCardNumber(argString(args, 'text'))) reasons.add('sensitive_field');
  }
  return [...reasons];
}

/** The Brain loop's `needsConfirm` for Rovr's browser tools. */
export function browserNeedsConfirm(ctx: () => SafetyContext): (req: { name: string; args: unknown }) => boolean {
  return (req) => classifyAction(req.name, req.args, ctx()).length > 0;
}
