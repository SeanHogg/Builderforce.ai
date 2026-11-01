/**
 * THE do-not-contact check. It is honoured by the three paths listed below and by NO
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
 *     the email and the E.164 number, and a member blocked on either is not texted.
 *   - The sales sequence runner (`sales/sequenceRunner.ts`) — a sequence send does not go
 *     through campaign materialisation, so the runner asks {@link suppressedEmails} itself,
 *     once per cadence, for every due step whose contact is an address or an E.164 number,
 *     on every channel. A hit stops that person.
 *   - Automatic mailbox replies (`mailbox/mailboxAutomationService.ts`, response mode
 *     `automatic`) — those send with nobody reviewing them, so the sender is checked before
 *     the reply is drafted. Rules in `draft` or `approval` mode put a human before the send
 *     and are not checked.
 *
 * WHO DOES NOT
 *   - A person sending one message by hand: `POST /connections/:id/send` in
 *     `presentation/routes/mailboxRoutes.ts`.
 *   - The agent-driven mailbox send tool in `application/llm/builtinMcpService.ts`.
 *   - A reply a person sends from an automation draft, or approves (`sendMailboxAutomationExecution`
 *     reached from the draft button or the approvals queue).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { resultRows } from '../kernel/metricRollup';
import { bareAddress, isE164 } from '../shared/contactAddress';

/** Well under Postgres' 65,535 bind-parameter cap, with room for the domain list. */
const CHUNK = 5_000;

const domainOf = (email: string): string => email.slice(email.lastIndexOf('@') + 1);

/**
 * The key a contact is checked, and compared, under: the lower-cased bare address
 * (`Jane <A@x.com>` → `a@x.com`) or the E.164 number; `null` for anything else (a social
 * handle, a CRM id), which no ledger can hold.
 */
export function suppressionKey(contact: string): string | null {
  const bare = bareAddress(contact).toLowerCase();
  if (/^[^\s@]+@[^\s@]+$/.test(bare)) return bare;
  return isE164(bare) ? bare : null;
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
