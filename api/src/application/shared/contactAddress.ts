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
  const text = withoutTrailingComments(value);
  return angleGroupsOf(text).at(-1) || text.trim();
}

/** Strip trailing comments, innermost first, so nested ones `(a (b))` unwind. An angle group
 *  inside a comment goes with it. Bounded: each pass removes at least one character. */
function withoutTrailingComments(value: string): string {
  let text = value.trim();
  for (let stripped = text.replace(/\s*\([^()]*\)\s*$/, ''); stripped !== text; stripped = text.replace(/\s*\([^()]*\)\s*$/, '')) {
    text = stripped;
  }
  return text;
}

/** The trimmed text of every `<...>` group in `text`. A quoted string is display text, never the
 *  address: it is dropped (backslash escapes honoured) before looking for groups, so
 *  `Eve <a@x.com> "<victim@y.com>"` cannot resolve to the decoy. Only the search text loses them. */
function angleGroupsOf(text: string): string[] {
  return [...text.replace(/"(?:[^"\\]|\\.)*"/g, '').matchAll(/<([^<>]+)>/g)].map((group) => group[1]!.trim());
}

/**
 * How many angle groups (`<...>`) the mailbox value holds, after the same comment and quoted-string
 * handling {@link bareAddress} applies. More than one is ambiguous (`<a@x.com> <b@y.com>`): the
 * parser takes the last, but a mail server is not obliged to, so a check that must not be fooled
 * (the do-not-contact one) treats it as unparseable rather than trusting that choice.
 */
export function angleGroupCount(value: string): number {
  return angleGroupsOf(withoutTrailingComments(value)).length;
}

/**
 * The canonical addr-spec of a bare address, so the same mailbox written differently compares
 * equal. Four spellings that name one mailbox are folded:
 *
 *   - comments anywhere, outside quoted strings: `erased(c)@x.com`, `erased@x.com (c)`, `(c) erased@x.com`;
 *   - an obsolete source route: `@a.com:erased@x.com`;
 *   - a quoted local part that is a plain atom: `"erased"@x.com` (a local part that genuinely needs
 *     its quotes, such as one with a space, is left as written);
 *   - a trailing dot on the domain: `erased@x.com.`.
 *
 * Anything else is returned trimmed and otherwise untouched. It does not validate: callers still
 * test the result against their own address shape.
 */
export function canonicalAddress(bare: string): string {
  let text = withoutComments(bare).trim();
  text = text.replace(/^@[^\s@:,]+(?:\s*,\s*@[^\s@:,]+)*\s*:/, '').trim();
  const quoted = /^"((?:[^"\\]|\\.)*)"@(.+)$/.exec(text);
  if (quoted) {
    const local = quoted[1]!.replace(/\\(.)/g, '$1');
    if (/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) text = `${local}@${quoted[2]!}`;
  }
  const at = text.lastIndexOf('@');
  return at < 0 ? text : `${text.slice(0, at + 1)}${text.slice(at + 1).replace(/\.+$/, '')}`;
}

/** `text` with every balanced comment removed; text inside a quoted string is kept as written and an
 *  unterminated comment swallows the rest. */
function withoutComments(text: string): string {
  let out = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) out += text[++i]!;
      else if (ch === '"') quoted = false;
    } else if (depth > 0) {
      if (ch === '\\') i++;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    } else if (ch === '(') depth++;
    else if (ch === '"') { quoted = true; out += ch; } else out += ch;
  }
  return out;
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

/**
 * Whether `value` contains a control character: any C0 control (NUL to US, which includes CR, LF
 * and tab), DEL, or a C1 control.
 *
 * A mailbox adapter writes `to`, `replyTo` and the subject into a message header, and a CR or LF
 * there ends the header and starts a new one: a `replyTo` of `x@y.com`, CR, LF, `Bcc: erased@x.com`
 * adds a recipient that no do-not-contact check ever looked at. Those fields can be
 * model-controlled (the agent send tool), so the one chokepoint that sends refuses them rather than
 * trusting each caller to have cleaned them. Pure, like the rest of this module.
 */
export function hasControlCharacter(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f-\u009f]/.test(value);
}

/** A number Twilio will accept: E.164, `+` then 8–15 digits. Checked before a
 *  campaign starts rather than per recipient, because a malformed FROM fails
 *  every message identically and should never reach the loop. */
export function isE164(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value.trim());
}
