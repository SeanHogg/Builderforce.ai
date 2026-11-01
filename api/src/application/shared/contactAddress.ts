/**
 * How a contact is written down, parsed once. Pure — no I/O, so any layer may import it
 * (and a test need not load a database or a transport to use it).
 */

/**
 * The bare address inside an RFC 5322 mailbox value: `Jane <a@x.com>` → `a@x.com`; a value
 * with no angle brackets is returned trimmed.
 *
 * The address is the LAST angle group: the display name is free text the sender controls, so
 * `"<victim@x.com>" <attacker@y.com>` must resolve to the attacker's real address (the one a
 * reply is delivered to), not to the decoy inside the quoted name. The group is NOT required to
 * end the value, because an RFC 5322 comment may follow it (`Jane <a@x.com> (Sales)`): trailing
 * comments are stripped first, then the last group is taken wherever it sits. Requiring the end
 * of the string made such a value fall through whole, `suppressionKey` read it as no address,
 * and a do-not-contact check passed for an erased person.
 *
 * Quoted strings (backslash escapes honoured) are display text and are removed before the angle
 * groups are looked for, so a decoy AFTER the real address, `Eve <a@x.com> "<victim@y.com>"`, is
 * not taken either: a suppressed `a@x.com` must not pass a do-not-contact check.
 *
 * ONE parser for every path that has to act on "who is this to": the mailbox automation
 * reply (the `To:` it sends to and the approval text it shows), the sequence runner (the
 * `to` it sends to) and the do-not-contact check (`marketing/suppression.ts`). They must
 * agree, or a send can go to an address the check never looked at.
 */
export function bareAddress(value: string): string {
  // Strip trailing comments, innermost first, so nested ones `(a (b))` unwind. An angle group
  // inside a comment goes with it. Bounded: each pass removes at least one character.
  let text = value.trim();
  for (let stripped = text.replace(/\s*\([^()]*\)\s*$/, ''); stripped !== text; stripped = text.replace(/\s*\([^()]*\)\s*$/, '')) {
    text = stripped;
  }
  // A quoted string is display text, never the address: drop it (backslash escapes honoured)
  // before looking for angle groups, so `Eve <a@x.com> "<victim@y.com>"` cannot resolve to the
  // decoy. Only the search text loses them; the no-group fallback below returns the value as given.
  const groups = [...text.replace(/"(?:[^"\\]|\\.)*"/g, '').matchAll(/<([^<>]+)>/g)];
  return groups.at(-1)?.[1]?.trim() || text.trim();
}

/**
 * The individual addresses in a mailbox-list value: `a@x.com, Jane <b@x.com>` → two entries.
 *
 * A `To:` is a LIST in RFC 5322 and the Gmail adapter writes the caller's `to` into that header
 * verbatim, so one string can address several people. A check that parses the whole value as one
 * address finds no address in a comma list and waves it through, so anything deciding "who is this
 * going to" splits first, then checks every entry.
 *
 * Splits on `,` and `;` (and the `:` of a group, `Team: a@x.com, b@x.com;`) only OUTSIDE quoted
 * strings, angle groups and comments, so `"Doe, Jane" <j@x.com>` stays one entry. Entries are
 * trimmed and empties dropped. Each entry is still a mailbox value: run it through
 * {@link bareAddress}.
 */
export function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angle = 0;
  let comment = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (quoted) {
      current += ch;
      if (ch === '\\' && i + 1 < value.length) current += value[++i]!;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === '<') angle++;
    else if (ch === '>' && angle > 0) angle--;
    else if (ch === '(') comment++;
    else if (ch === ')' && comment > 0) comment--;
    else if ((ch === ',' || ch === ';' || ch === ':') && angle === 0 && comment === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** A number Twilio will accept: E.164, `+` then 8–15 digits. Checked before a
 *  campaign starts rather than per recipient, because a malformed FROM fails
 *  every message identically and should never reach the loop. */
export function isE164(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value.trim());
}
