/**
 * How a contact is written down, parsed once. Pure — no I/O, so any layer may import it
 * (and a test need not load a database or a transport to use it).
 */

/**
 * The bare address inside an RFC 5322 mailbox value: `Jane <a@x.com>` → `a@x.com`; a value
 * with no angle brackets is returned trimmed.
 *
 * The address is the LAST angle group, anchored to the end: the display name is free text the
 * sender controls, so `"<victim@x.com>" <attacker@y.com>` must resolve to the attacker's real
 * address (the one a reply is delivered to), not to the decoy inside the quoted name.
 *
 * ONE parser for every path that has to act on "who is this to": the mailbox automation
 * reply (the `To:` it sends to and the approval text it shows), the sequence runner (the
 * `to` it sends to) and the do-not-contact check (`marketing/suppression.ts`). They must
 * agree, or a send can go to an address the check never looked at.
 */
export function bareAddress(value: string): string {
  return value.match(/<([^<>]+)>\s*$/)?.[1]?.trim() || value.trim();
}

/** A number Twilio will accept: E.164, `+` then 8–15 digits. Checked before a
 *  campaign starts rather than per recipient, because a malformed FROM fails
 *  every message identically and should never reach the loop. */
export function isE164(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value.trim());
}
