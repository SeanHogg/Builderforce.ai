/**
 * THE do-not-contact check. It is honoured by the paths listed below and by NO
 * other: a send path that is not listed here does not ask.
 *
 * Two ledgers say "do not contact" and both must be honoured:
 *   - `marketing_suppressions`  — unsubscribes, bounces, complaints (campaign engine writes it)
 *   - `data_suppression_list`   — the governance register (erasure requests, opt-outs,
 *     manual adds): an `email`, a `domain` or a `phone_e164`. An erased person must stay
 *     erased, so it has to veto a send even though the campaign engine never wrote it.
 *
 * Every read is ONE statement per chunk (never per recipient), because every statement is
 * a Neon round trip. {@link suppressionKey} is the one normaliser: the check, and every
 * caller comparing its answer, key a contact the same way.
 *
 * WHO HONOURS IT
 *   - Campaigns (email and SMS, which the newsletter send uses) — recipient lists are built
 *     in one place, `campaign/start.ts`, and {@link suppressedEmails} runs there. An email
 *     campaign is checked on each member's EMAIL, the audience's key; an SMS campaign on BOTH
 *     the email and the E.164 number, and a member blocked on either is not texted. The check is
 *     repeated for each batch in `campaign/send.ts`, so a person erased while a long send is in
 *     flight does not receive the rest of it.
 *   - The sales sequence runner (`sales/sequenceRunner.ts`) — a sequence send does not go
 *     through campaign materialisation, so the runner asks {@link suppressedEmails} itself,
 *     once per cadence, for every due step whose contact is an address or an E.164 number,
 *     on every channel. A hit stops that person.
 *   - Automatic mailbox replies (`mailbox/mailboxAutomationService.ts`, response mode
 *     `automatic`) — those send with nobody reviewing them, so the sender is checked before
 *     the reply is drafted. Rules in `draft` or `approval` mode put a human before the send
 *     and are not checked.
 *   - The agent-driven mailbox send tool (`mailbox.send` in `application/llm/builtinMcpService.ts`)
 *     — an agent has no person in the loop, so a do-not-contact recipient is refused outright
 *     ({@link isDoNotContact}). EVERY address in `to` is checked (`splitAddressList`), and an
 *     entry that cannot be read as one address is refused too (it fails closed).
 *   - A person sending one message by hand (`POST /connections/:id/send` in
 *     `presentation/routes/mailboxRoutes.ts`) — WARNED AND CONFIRMED: a person may knowingly
 *     contact someone (a reply to a customer who unsubscribed from marketing), but must be told
 *     first. The route answers 409 `do_not_contact` until the request carries
 *     `confirmDoNotContact: true`; the inbox and canvas composers ask, then resend.
 *
 * WHO DOES NOT
 *   - A reply a person sends from an automation draft, or approves (`sendMailboxAutomationExecution`
 *     reached from the draft button or the approvals queue).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { resultRows } from '../kernel/metricRollup';
import { angleGroupCount, bareAddress, canonicalAddress, isE164, splitAddressList } from '../shared/contactAddress';

/** Well under Postgres' 65,535 bind-parameter cap, with room for the domain list. */
const CHUNK = 5_000;

const domainOf = (email: string): string => email.slice(email.lastIndexOf('@') + 1);

/**
 * The key a contact is checked, and compared, under: the lower-cased canonical address
 * (`Jane <A@x.com>` → `a@x.com`) or the E.164 number; `null` for anything else (a social
 * handle, a CRM id), which no ledger can hold.
 *
 * Equivalent spellings of one mailbox share a key ({@link canonicalAddress}): a quoted local part
 * (`"a"@x.com`), comments (`a(c)@x.com`, `<a@x.com (c)>`), an obsolete route (`<@r.com:a@x.com>`)
 * and a trailing dot (`a@x.com.`). Without that an erased person's address, written another way,
 * would carry a different key and walk past the register.
 */
export function suppressionKey(contact: string): string | null {
  const bare = canonicalAddress(bareAddress(contact)).toLowerCase();
  if (/^[^\s@]+@[^\s@]+$/.test(bare)) return bare;
  return isE164(bare) ? bare : null;
}

/**
 * Whether ANY address in `to` may not be contacted. `to` is a mailbox value or a list of them
 * (`splitAddressList`): the Gmail adapter sends a comma list to everyone on it, so one entry
 * on a ledger makes the whole send a do-not-contact one. One statement however long the list.
 *
 * FAILS CLOSED. This guard decides whether something may be sent at all, so an entry it cannot
 * reduce to one address is a do-not-contact one: no {@link suppressionKey} (`Jane a@x.com`,
 * `a@x.com b@y.com`, an unterminated `Jane <a@x.com, b@y.com`), or more than one angle group
 * (`<a@x.com> <b@y.com>`), where the parser would pick one address and the mail server another.
 * A parser that waves through what it cannot read is a way round the register. (The contract of
 * {@link suppressedEmails} is different on purpose: a social handle is no address and passes.)
 */
export async function isDoNotContact(db: Db, tenantId: number, to: string): Promise<boolean> {
  const entries = splitAddressList(to);
  if (entries.some((entry) => suppressionKey(entry) === null || angleGroupCount(entry) > 1)) return true;
  return (await suppressedEmails(db, tenantId, entries)).size > 0;
}

/**
 * The keys a campaign member is checked under, per channel. An email campaign reaches the ADDRESS;
 * an SMS reaches the NUMBER, and the register holds numbers (`phone_e164`) as well as addresses, so
 * an SMS member is checked on BOTH. ONE definition for the start pre-flight and the per-batch
 * re-check, so the two cannot disagree about whom they looked at.
 */
export function campaignMemberKeys(channel: 'email' | 'sms', member: { email: string; phone: string | null }): string[] {
  return channel === 'sms' ? [member.email, member.phone ?? ''] : [member.email];
}

/** Whether any of a member's keys is in `blocked` (the answer of {@link suppressedEmails}). */
export function isMemberBlocked(blocked: ReadonlySet<string>, keys: string[]): boolean {
  return keys.some((contact) => {
    const key = suppressionKey(contact);
    return key !== null && blocked.has(key);
  });
}

/**
 * The subset of `contacts` this tenant may not contact, as {@link suppressionKey}s. A
 * contact with no key is never blocked (and never queried); a number is matched against the
 * register's `phone_e164` entries.
 */
export async function suppressedEmails(db: Db, tenantId: number, contacts: string[]): Promise<Set<string>> {
  const blocked = new Set<string>();
  const unique = [...new Set(contacts.map(suppressionKey).filter((key): key is string => key !== null))];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const domains = [...new Set(batch.map(domainOf))];
    const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);
    const rows = resultRows(await db.execute(sql`
      SELECT 'e' AS k, email AS v FROM marketing_suppressions
       WHERE tenant_id = ${tenantId} AND email IN (${list(batch)})
      UNION ALL
      SELECT 'e', LOWER(identifier_value) FROM data_suppression_list
       WHERE tenant_id = ${tenantId} AND LOWER(identifier_type) IN ('email', 'phone_e164') AND LOWER(identifier_value) IN (${list(batch)})
      UNION ALL
      SELECT 'd', LOWER(identifier_value) FROM data_suppression_list
       WHERE tenant_id = ${tenantId} AND LOWER(identifier_type) = 'domain' AND LOWER(identifier_value) IN (${list(domains)})
    `));
    const blockedDomains = new Set(rows.filter((r) => r.k === 'd').map((r) => String(r.v)));
    const blockedEmails = new Set(rows.filter((r) => r.k === 'e').map((r) => String(r.v)));
    for (const key of batch) {
      if (blockedEmails.has(key) || (key.includes('@') && blockedDomains.has(domainOf(key)))) blocked.add(key);
    }
  }
  return blocked;
}
