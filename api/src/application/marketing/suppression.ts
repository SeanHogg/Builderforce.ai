/**
 * THE do-not-contact check for every marketing send path.
 *
 * Two ledgers say "do not contact" and both must be honoured:
 *   - `marketing_suppressions`  — unsubscribes, bounces, complaints (campaign engine writes it)
 *   - `data_suppression_list`   — the governance register (erasure requests, opt-outs,
 *     manual adds). An erased person must stay erased, so it has to veto a send
 *     even though the campaign engine never wrote it.
 *
 * Both are read in ONE statement per chunk (never per recipient), because every
 * statement is a Neon round trip. Campaign materialisation is the single place a
 * recipient list is built (sequences and the newsletter send as campaigns), so
 * that is where {@link suppressedEmails} runs.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { resultRows } from '../kernel/metricRollup';

/** Well under Postgres' 65,535 bind-parameter cap, with room for the domain list. */
const CHUNK = 5_000;

const domainOf = (email: string): string => email.slice(email.lastIndexOf('@') + 1);

/** The subset of `emails` this tenant may not contact. Addresses are compared lower-cased. */
export async function suppressedEmails(db: Db, tenantId: number, emails: string[]): Promise<Set<string>> {
  const blocked = new Set<string>();
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const domains = [...new Set(batch.map(domainOf))];
    const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);
    const rows = resultRows(await db.execute(sql`
      SELECT 'e' AS k, email AS v FROM marketing_suppressions
       WHERE tenant_id = ${tenantId} AND email IN (${list(batch)})
      UNION ALL
      SELECT 'e', LOWER(identifier_value) FROM data_suppression_list
       WHERE tenant_id = ${tenantId} AND identifier_type = 'email' AND LOWER(identifier_value) IN (${list(batch)})
      UNION ALL
      SELECT 'd', LOWER(identifier_value) FROM data_suppression_list
       WHERE tenant_id = ${tenantId} AND identifier_type = 'domain' AND LOWER(identifier_value) IN (${list(domains)})
    `));
    const blockedDomains = new Set(rows.filter((r) => r.k === 'd').map((r) => String(r.v)));
    const blockedEmails = new Set(rows.filter((r) => r.k === 'e').map((r) => String(r.v)));
    for (const email of batch) {
      if (blockedEmails.has(email) || blockedDomains.has(domainOf(email))) blocked.add(email);
    }
  }
  return blocked;
}

export async function isSuppressed(db: Db, tenantId: number, email: string): Promise<boolean> {
  return (await suppressedEmails(db, tenantId, [email])).size > 0;
}
