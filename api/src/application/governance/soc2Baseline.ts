/**
 * The SOC 2 Common Criteria baseline (CC1–CC9) and the ONE seeding path.
 *
 * Lived inline in `governanceRoutes.ts`; the DevSecOps layer needs to seed it too (automated
 * evidence for CC8.1 / CC7.1 has nowhere to land in a segment whose controls were never seeded), so
 * the list and the seeding live here and the route is a caller.
 */
import { and, eq, sql } from 'drizzle-orm';
import { inTransaction, type Db } from '../../infrastructure/database/connection';
import { socControls } from '../../infrastructure/database/schema';

/** SOC 2 Common Criteria baseline (seeded on first use). */
export const SOC2_BASELINE: ReadonlyArray<{ controlRef: string; category: string; name: string; requirement: string }> = [
  { controlRef: 'CC1.1', category: 'CC1', name: 'Integrity & ethical values', requirement: 'The entity demonstrates a commitment to integrity and ethical values.' },
  { controlRef: 'CC1.2', category: 'CC1', name: 'Board independence & oversight', requirement: 'The board exercises oversight independent of management.' },
  { controlRef: 'CC1.3', category: 'CC1', name: 'Structures & reporting lines', requirement: 'Management establishes structures, reporting lines, authorities and responsibilities.' },
  { controlRef: 'CC1.4', category: 'CC1', name: 'Commitment to competence', requirement: 'The entity attracts, develops and retains competent individuals.' },
  { controlRef: 'CC2.1', category: 'CC2', name: 'Quality information', requirement: 'The entity obtains and uses relevant, quality information.' },
  { controlRef: 'CC2.2', category: 'CC2', name: 'Internal communication', requirement: 'The entity internally communicates information needed for controls.' },
  { controlRef: 'CC2.3', category: 'CC2', name: 'External communication', requirement: 'The entity communicates with external parties about controls.' },
  { controlRef: 'CC3.1', category: 'CC3', name: 'Objectives & risk', requirement: 'The entity specifies objectives to enable identification of risks.' },
  { controlRef: 'CC3.2', category: 'CC3', name: 'Risk identification', requirement: 'The entity identifies and analyzes risks to its objectives.' },
  { controlRef: 'CC3.3', category: 'CC3', name: 'Fraud risk', requirement: 'The entity considers the potential for fraud in assessing risks.' },
  { controlRef: 'CC3.4', category: 'CC3', name: 'Change risk', requirement: 'The entity identifies and assesses changes that could impact controls.' },
  { controlRef: 'CC4.1', category: 'CC4', name: 'Control monitoring', requirement: 'The entity selects, develops and performs evaluations of controls.' },
  { controlRef: 'CC4.2', category: 'CC4', name: 'Deficiency communication', requirement: 'The entity evaluates and communicates control deficiencies.' },
  { controlRef: 'CC5.1', category: 'CC5', name: 'Control activities', requirement: 'The entity selects and develops control activities that mitigate risk.' },
  { controlRef: 'CC5.2', category: 'CC5', name: 'Technology controls', requirement: 'The entity selects and develops general control activities over technology.' },
  { controlRef: 'CC5.3', category: 'CC5', name: 'Policies & procedures', requirement: 'The entity deploys control activities through policies and procedures.' },
  { controlRef: 'CC6.1', category: 'CC6', name: 'Logical access', requirement: 'The entity implements logical access security over protected information assets.' },
  { controlRef: 'CC6.2', category: 'CC6', name: 'Access provisioning', requirement: 'Access is registered, authorized and de-provisioned in a timely manner.' },
  { controlRef: 'CC6.3', category: 'CC6', name: 'Access removal', requirement: 'The entity removes access to protected assets when no longer required.' },
  { controlRef: 'CC6.6', category: 'CC6', name: 'External threats', requirement: 'The entity implements controls to protect against external threats.' },
  { controlRef: 'CC6.7', category: 'CC6', name: 'Data transmission', requirement: 'The entity restricts the transmission/movement of information.' },
  { controlRef: 'CC7.1', category: 'CC7', name: 'Vulnerability detection', requirement: 'The entity uses detection/monitoring to identify vulnerabilities.' },
  { controlRef: 'CC7.2', category: 'CC7', name: 'Security monitoring', requirement: 'The entity monitors system components for anomalies.' },
  { controlRef: 'CC7.3', category: 'CC7', name: 'Incident evaluation', requirement: 'The entity evaluates security events to determine a response.' },
  { controlRef: 'CC7.4', category: 'CC7', name: 'Incident response', requirement: 'The entity responds to identified security incidents.' },
  { controlRef: 'CC8.1', category: 'CC8', name: 'Change management', requirement: 'The entity authorizes, designs, tests and approves changes.' },
  { controlRef: 'CC9.1', category: 'CC9', name: 'Risk mitigation', requirement: 'The entity identifies and develops risk mitigation activities.' },
  { controlRef: 'CC9.2', category: 'CC9', name: 'Vendor risk', requirement: 'The entity assesses and manages risks from vendors and partners.' },
];

/** Seed the baseline once per segment. Returns how many controls were inserted (0 when already present). */
export async function ensureSoc2Baseline(db: Db, tenantId: number, segmentId: string): Promise<number> {
  // RACE-SAFE: the check-then-insert runs under a transaction-scoped advisory lock keyed on the
  // segment, so two concurrent seeders (the seed route and an automated-evidence write, or two
  // evidence writes) serialise and the second sees the first's rows instead of inserting 27 duplicates.
  return inTransaction(db, async (tx) => {
    const q = tx as unknown as Db;
    await q.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`soc2-baseline:${tenantId}:${segmentId}`}))`);
    const existing = await q
      .select({ id: socControls.id })
      .from(socControls)
      .where(and(eq(socControls.tenantId, tenantId), eq(socControls.segmentId, segmentId)))
      .limit(1);
    if (existing.length > 0) return 0;
    await q.insert(socControls).values(SOC2_BASELINE.map((ctl) => ({ ...ctl, tenantId, segmentId })));
    return SOC2_BASELINE.length;
  });
}
