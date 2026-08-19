/**
 * The RFP risk / dependency REGISTER (migration 0483).
 *
 * A generated proposal has always carried risks and dependencies, but they lived
 * only as JSON inside `rfp_responses.body`. That is enough to PRINT a document
 * and not enough to run a business off: nothing could ask which risk we raise on
 * every bid, how much open high-severity exposure the live pipeline carries, or
 * who owns a third-party dependency two proposals both depend on.
 *
 * So the same fact is also written as rows. The document stays the source of the
 * NARRATIVE (it is what the customer receives); the register is the source of
 * the ANALYTICS and of the lifecycle a document has no room for — a risk that
 * has since been accepted, mitigated or closed, and the person who owns it.
 *
 * Projection is delete-then-insert per response: regenerating a proposal
 * REPLACES its entries rather than accumulating a second set. Entries a person
 * has since acted on are preserved by title, because losing "we already mitigated
 * this" on every regeneration would make the lifecycle worthless.
 */
import { and, eq, inArray, desc } from 'drizzle-orm';
import { rfpRisks } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type {
  RfpRisk, RfpDependency, RfpRegisterEntry, RfpRegisterRollup,
} from './types';

type Severity = 'low' | 'medium' | 'high';
type EntryStatus = 'open' | 'accepted' | 'mitigated' | 'closed';
type DependencyType = 'internal' | 'external' | 'third_party';

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

export interface ProjectRegisterArgs {
  tenantId: number;
  segmentId: string | null;
  responseId: string;
  requestId: string;
  risks: readonly RfpRisk[];
  dependencies: readonly RfpDependency[];
}

/** Write one response's risks + dependencies into the register. */
export async function projectRiskRegister(db: Db, args: ProjectRegisterArgs): Promise<void> {
  const { tenantId, segmentId, responseId, requestId } = args;

  // What a person has already decided about these titles, so a regeneration does
  // not silently reopen a risk the team accepted last week.
  const decided = new Map<string, { status: EntryStatus; ownerUserId: string | null }>();
  try {
    const prior = await db
      .select({ title: rfpRisks.title, kind: rfpRisks.kind, status: rfpRisks.status, ownerUserId: rfpRisks.ownerUserId })
      .from(rfpRisks)
      .where(and(eq(rfpRisks.tenantId, tenantId), eq(rfpRisks.responseId, responseId)));
    for (const row of prior) {
      if (row.status !== 'open' || row.ownerUserId) decided.set(`${row.kind}:${row.title}`, { status: row.status, ownerUserId: row.ownerUserId });
    }
  } catch { /* a fresh response has no prior rows */ }

  await db.delete(rfpRisks).where(and(eq(rfpRisks.tenantId, tenantId), eq(rfpRisks.responseId, responseId)));

  const carry = (kind: 'risk' | 'dependency', title: string) =>
    decided.get(`${kind}:${title}`) ?? { status: 'open' as EntryStatus, ownerUserId: null };

  const rows = [
    ...args.risks.map((r, i) => {
      const title = String(r.title ?? '').slice(0, 255) || 'Untitled risk';
      const prior = carry('risk', title);
      return {
        tenantId, segmentId, responseId, requestId,
        kind: 'risk' as const,
        title,
        severity: (['low', 'medium', 'high'] as const).includes(r.severity) ? r.severity : ('medium' as Severity),
        dependencyType: null,
        detail: r.mitigation ?? null,
        status: prior.status,
        ownerUserId: prior.ownerUserId,
        position: i,
      };
    }),
    ...args.dependencies.map((d, i) => {
      const title = String(d.title ?? '').slice(0, 255) || 'Untitled dependency';
      const prior = carry('dependency', title);
      return {
        tenantId, segmentId, responseId, requestId,
        kind: 'dependency' as const,
        title,
        severity: null,
        dependencyType: (['internal', 'external', 'third_party'] as const).includes(d.type) ? d.type : ('external' as DependencyType),
        detail: d.note ?? null,
        status: prior.status,
        ownerUserId: prior.ownerUserId,
        position: i,
      };
    }),
  ];
  if (rows.length) await db.insert(rfpRisks).values(rows);
}

function toEntry(row: typeof rfpRisks.$inferSelect): RfpRegisterEntry {
  return {
    id: row.id,
    responseId: row.responseId,
    requestId: row.requestId,
    kind: row.kind,
    title: row.title,
    severity: row.severity ?? null,
    dependencyType: row.dependencyType ?? null,
    detail: row.detail,
    status: row.status,
    ownerUserId: row.ownerUserId,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface RegisterQuery {
  kind?: 'risk' | 'dependency';
  status?: EntryStatus;
  severity?: Severity;
  requestId?: string;
  responseId?: string;
  limit?: number;
}

/** The register for one tenant, newest first, plus the roll-up over the SAME
 *  filtered set — so the headline numbers can never describe a different slice
 *  than the rows underneath them. */
export async function readRiskRegister(
  db: Db,
  tenantId: number,
  query: RegisterQuery = {},
): Promise<{ entries: RfpRegisterEntry[]; rollup: RfpRegisterRollup }> {
  const filters = [eq(rfpRisks.tenantId, tenantId)];
  if (query.kind) filters.push(eq(rfpRisks.kind, query.kind));
  if (query.status) filters.push(eq(rfpRisks.status, query.status));
  if (query.severity) filters.push(eq(rfpRisks.severity, query.severity));
  if (query.requestId) filters.push(eq(rfpRisks.requestId, query.requestId));
  if (query.responseId) filters.push(eq(rfpRisks.responseId, query.responseId));

  const rows = await db
    .select()
    .from(rfpRisks)
    .where(and(...filters))
    .orderBy(desc(rfpRisks.createdAt), rfpRisks.position)
    .limit(Math.min(Math.max(query.limit ?? 500, 1), 2000));

  return { entries: rows.map(toEntry), rollup: rollupRegister(rows.map(toEntry)) };
}

/** The cross-response roll-up. Pure, so it is testable without a database and
 *  so the same shape can be computed over an already-fetched slice. */
export function rollupRegister(entries: readonly RfpRegisterEntry[]): RfpRegisterRollup {
  const bySeverity: Record<Severity, number> = { low: 0, medium: 0, high: 0 };
  const byStatus: Record<EntryStatus, number> = { open: 0, accepted: 0, mitigated: 0, closed: 0 };
  const byDependencyType: Record<DependencyType, number> = { internal: 0, external: 0, third_party: 0 };
  const seen = new Map<string, { title: string; kind: 'risk' | 'dependency'; responses: Set<string>; worst: Severity | null }>();

  let totalRisks = 0;
  let totalDependencies = 0;
  let openHighRisks = 0;

  for (const e of entries) {
    byStatus[e.status] += 1;
    if (e.kind === 'risk') {
      totalRisks += 1;
      if (e.severity) bySeverity[e.severity] += 1;
      if (e.severity === 'high' && e.status === 'open') openHighRisks += 1;
    } else {
      totalDependencies += 1;
      if (e.dependencyType) byDependencyType[e.dependencyType] += 1;
    }

    // Recurrence is keyed on the normalised title: "Scope ambiguity" and "scope
    // ambiguity " are the same risk raised twice, and counting them apart would
    // hide exactly the pattern this roll-up exists to show.
    const key = `${e.kind}:${e.title.trim().toLowerCase()}`;
    const bucket = seen.get(key) ?? { title: e.title, kind: e.kind, responses: new Set<string>(), worst: null };
    bucket.responses.add(e.responseId);
    if (e.severity && (!bucket.worst || SEVERITY_RANK[e.severity] > SEVERITY_RANK[bucket.worst])) bucket.worst = e.severity;
    seen.set(key, bucket);
  }

  const recurring = [...seen.values()]
    .filter((b) => b.responses.size > 1)
    .map((b) => ({ title: b.title, kind: b.kind, responses: b.responses.size, worstSeverity: b.worst }))
    .sort((a, b) => b.responses - a.responses || a.title.localeCompare(b.title))
    .slice(0, 20);

  return { totalRisks, totalDependencies, openHighRisks, bySeverity, byStatus, byDependencyType, recurring };
}

/** Update one entry's lifecycle. Returns null when it is not this tenant's. */
export async function updateRegisterEntry(
  db: Db,
  tenantId: number,
  id: string,
  patch: { status?: EntryStatus; ownerUserId?: string | null; detail?: string | null },
): Promise<RfpRegisterEntry | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status && (['open', 'accepted', 'mitigated', 'closed'] as const).includes(patch.status)) set.status = patch.status;
  if (patch.ownerUserId !== undefined) set.ownerUserId = patch.ownerUserId;
  if (patch.detail !== undefined) set.detail = patch.detail;

  const [row] = await db.update(rfpRisks).set(set)
    .where(and(eq(rfpRisks.id, id), eq(rfpRisks.tenantId, tenantId)))
    .returning();
  return row ? toEntry(row) : null;
}

/** Drop a response's entries — used when a response itself is discarded and the
 *  cascade cannot be relied on (a soft delete rather than a row delete). */
export async function clearRegisterFor(db: Db, tenantId: number, responseIds: readonly string[]): Promise<void> {
  if (!responseIds.length) return;
  await db.delete(rfpRisks).where(and(eq(rfpRisks.tenantId, tenantId), inArray(rfpRisks.responseId, [...responseIds])));
}
