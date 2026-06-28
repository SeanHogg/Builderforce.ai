/**
 * SOC 1 Type II controls register.
 *
 * A SOC 1 audit attests that controls relevant to a service org's financial
 * reporting are (Type II) operating effectively over a period. We ship a seeded
 * register of common control objectives ({@link DEFAULT_SOC_CONTROLS}) spanning
 * access control, change management, deployment, monitoring and backup, and let a
 * manager maintain a per-control assertion (status / owner / last_reviewed / note).
 * The objective evidence reuses the existing tool_audit_events trail (see
 * complianceInsights) — this layer is the human-attested control coverage on top.
 *
 * A tenant with no rows yet sees the defaults rendered read-only as 'gap'; the
 * route seeds the register on first write so the table stays authoritative.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { socControls } from './finopsTables';

export type SocControlStatus = 'implemented' | 'partial' | 'gap';

export interface SocControlSeed {
  controlRef: string;
  objective: string;
  category: string;
}

export interface SocControl extends SocControlSeed {
  id: number | null; // null = default (not yet persisted)
  status: SocControlStatus;
  owner: string | null;
  note: string;
  lastReviewed: string | null; // ISO
}

/** ~10 common SOC 1 control objectives across the core control families. */
export const DEFAULT_SOC_CONTROLS: SocControlSeed[] = [
  { controlRef: 'CC-AC-01', objective: 'Logical access to production systems is restricted to authorized personnel via unique credentials.', category: 'access_control' },
  { controlRef: 'CC-AC-02', objective: 'Access is reviewed at least quarterly and revoked promptly upon role change or termination.', category: 'access_control' },
  { controlRef: 'CC-CM-01', objective: 'Code and configuration changes are tracked, peer-reviewed, and approved before merge.', category: 'change_management' },
  { controlRef: 'CC-CM-02', objective: 'Changes are tested in a non-production environment prior to release.', category: 'change_management' },
  { controlRef: 'CC-DP-01', objective: 'Deployments to production are automated, logged, and traceable to an approved change.', category: 'deployment' },
  { controlRef: 'CC-DP-02', objective: 'Production deployments support rollback to a prior known-good state.', category: 'deployment' },
  { controlRef: 'CC-MO-01', objective: 'System and agent-tool activity is logged to an immutable audit trail and retained.', category: 'monitoring' },
  { controlRef: 'CC-MO-02', objective: 'Sensitive / state-changing operations are monitored and alerted on.', category: 'monitoring' },
  { controlRef: 'CC-BK-01', objective: 'Critical data is backed up on a defined schedule and backups are protected.', category: 'backup' },
  { controlRef: 'CC-BK-02', objective: 'Restore from backup is periodically tested to validate recoverability.', category: 'backup' },
];

export interface ControlCoverage {
  total: number;
  implemented: number;
  partial: number;
  gap: number;
  coveragePct: number; // implemented / total × 100
  /** True when the register has not been persisted yet (showing seeded defaults). */
  seeded: boolean;
  controls: SocControl[];
}

function normalizeStatus(s: string | null | undefined): SocControlStatus {
  return s === 'implemented' || s === 'partial' || s === 'gap' ? s : 'gap';
}

/** Pure: roll up a list of controls into the coverage summary. */
export function summarizeCoverage(controls: SocControl[], seeded: boolean): ControlCoverage {
  let implemented = 0, partial = 0, gap = 0;
  for (const c of controls) {
    if (c.status === 'implemented') implemented += 1;
    else if (c.status === 'partial') partial += 1;
    else gap += 1;
  }
  const total = controls.length;
  return {
    total,
    implemented,
    partial,
    gap,
    coveragePct: total > 0 ? (implemented / total) * 100 : 0,
    seeded,
    controls,
  };
}

/**
 * Coverage for a tenant. When no rows exist, returns the seeded defaults as 'gap'
 * (read-only, id=null) so the register is visible before first write.
 */
export async function computeControlCoverage(db: Db, tenantId: number): Promise<ControlCoverage> {
  const rows = await db
    .select({
      id: socControls.id,
      controlRef: socControls.controlRef,
      objective: socControls.objective,
      category: socControls.category,
      status: socControls.status,
      owner: socControls.owner,
      note: socControls.note,
      lastReviewed: socControls.lastReviewed,
    })
    .from(socControls)
    .where(eq(socControls.tenantId, tenantId));

  if (rows.length === 0) {
    const controls: SocControl[] = DEFAULT_SOC_CONTROLS.map((d) => ({
      id: null,
      controlRef: d.controlRef,
      objective: d.objective,
      category: d.category,
      status: 'gap',
      owner: null,
      note: '',
      lastReviewed: null,
    }));
    return summarizeCoverage(controls, true);
  }

  const controls: SocControl[] = rows
    .map((r) => ({
      id: r.id,
      controlRef: r.controlRef,
      objective: r.objective,
      category: r.category,
      status: normalizeStatus(r.status),
      owner: r.owner ?? null,
      note: r.note ?? '',
      lastReviewed: r.lastReviewed ? new Date(r.lastReviewed).toISOString() : null,
    }))
    .sort((a, b) => a.controlRef.localeCompare(b.controlRef));
  return summarizeCoverage(controls, false);
}
