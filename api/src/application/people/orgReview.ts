/**
 * `hr.org_review` — spans and layers over a real roster.
 *
 * ── WHAT AN ORG REVIEW ACTUALLY IS ───────────────────────────────────────────
 * Two numbers and their tails. SPAN is how many people report to one manager;
 * LAYERS is how many managers sit between an individual contributor and the top.
 * Every org-design conversation that is worth having starts from those two, and
 * almost nobody can answer them, because the answer requires the whole reporting
 * graph at once and the org chart in most companies is a slide.
 *
 * ── WHY THE FINDINGS QUOTE PEOPLE ────────────────────────────────────────────
 * A number without its tail is not actionable: "average span 5.2" is true of a
 * healthy org and of one where four managers carry twenty reports each while
 * eleven carry one. So every finding here names the specific rows behind it, the
 * same discipline `resumeAnalysis` follows — the model writes the paragraph, this
 * supplies the evidence it is allowed to write from.
 *
 * ── WHAT IT REFUSES TO DO ────────────────────────────────────────────────────
 * It does not recommend a reorganisation and it does not score the org out of
 * 100. A span of 3 is correct for a team of surgeons and wrong for a team of
 * support agents, and nothing in a roster distinguishes them. What it can say
 * without knowing the work is where the STRUCTURE is internally inconsistent — a
 * manager with one report, a cycle in the reporting line, a manager id pointing
 * at nobody, an org whose depth exceeds its width. Those are defects at any
 * company, and they are what it reports.
 *
 * Pure: rows in, rows out. No database, no network, no clock beyond a `now` the
 * caller passes.
 */

import { avg, median } from '../shared/stats';
import type { RosterPerson } from './roster';

/** Above this many direct reports a manager is flagged as stretched. Declared
 *  rather than buried, and overridable, because the right number is a property of
 *  the WORK and this module cannot see the work. */
export const DEFAULT_WIDE_SPAN = 10;

/** Below this, a "manager" is a title rather than a job. One report is the case
 *  that matters: it is almost always a layer that exists for a promotion. */
export const NARROW_SPAN = 1;

export interface SpanRow {
  externalId: string;
  name: string;
  title: string | null;
  department: string | null;
  /** People who report directly to this person. */
  directReports: number;
  /** Everybody beneath them, at any depth. */
  totalReports: number;
  /** 0 for someone with no manager on the roster. */
  depth: number;
}

export interface LayerRow {
  depth: number;
  headcount: number;
  managers: number;
  /** A few titles at this depth, so a reader can tell what the layer IS. */
  sampleTitles: string[];
}

export type Severity = 'high' | 'medium' | 'low';

export interface OrgFinding {
  code:
    | 'reporting_cycle' | 'unresolved_manager' | 'multiple_roots' | 'no_root'
    | 'single_report_manager' | 'wide_span' | 'deep_org' | 'department_without_manager'
    | 'manager_missing_department';
  severity: Severity;
  headline: string;
  /** The specific rows behind the number. Bounded — a finding is read, not paged. */
  evidence: string[];
  count: number;
}

export interface OrgReview {
  ok: true;
  source: string;
  headcount: number;
  managers: number;
  individualContributors: number;
  /** Managers ÷ headcount. The number a "too many chiefs" argument needs. */
  managerRatio: number;
  layers: LayerRow[];
  maxDepth: number;
  averageSpan: number | null;
  medianSpan: number | null;
  /** Widest first — the tail that an average hides. */
  spans: SpanRow[];
  departments: Array<{ department: string; headcount: number; managers: number; maxDepth: number }>;
  findings: OrgFinding[];
  assumptions: string[];
  instruction: string;
}

const EVIDENCE_CAP = 12;

/** People who still work here. A terminated row is history, not structure. */
export const employed = (people: readonly RosterPerson[]): RosterPerson[] =>
  people.filter((p) => p.status !== 'terminated');

/**
 * Review the org.
 *
 * The graph is walked breadth-first from the roots so a CYCLE is detected rather
 * than hung on — a reporting cycle is rare and real (two people made each other's
 * manager during a reorg), and a naive depth walk on one recurses until the stack
 * gives out. Anybody unreachable from a root after the walk is in a cycle, which
 * is both the detection and the report.
 */
export function reviewOrg(
  people: readonly RosterPerson[],
  options: { source?: string; wideSpan?: number } = {},
): OrgReview {
  const wideSpan = options.wideSpan ?? DEFAULT_WIDE_SPAN;
  const roster = employed(people);
  const byId = new Map(roster.map((p) => [p.externalId, p]));

  const directReports = new Map<string, RosterPerson[]>();
  const unresolved: RosterPerson[] = [];
  const roots: RosterPerson[] = [];
  for (const person of roster) {
    const managerId = person.managerExternalId;
    if (!managerId) { roots.push(person); continue; }
    if (managerId === person.externalId) { unresolved.push(person); roots.push(person); continue; }
    const manager = byId.get(managerId);
    if (!manager) { unresolved.push(person); roots.push(person); continue; }
    directReports.set(managerId, [...(directReports.get(managerId) ?? []), person]);
  }

  // Breadth-first from every root. `depth` is only ever written once per person,
  // so a cycle cannot revisit and cannot deepen.
  const depth = new Map<string, number>();
  const queue: Array<{ person: RosterPerson; depth: number }> = roots.map((person) => ({ person, depth: 0 }));
  while (queue.length) {
    const next = queue.shift()!;
    if (depth.has(next.person.externalId)) continue;
    depth.set(next.person.externalId, next.depth);
    for (const report of directReports.get(next.person.externalId) ?? []) {
      if (!depth.has(report.externalId)) queue.push({ person: report, depth: next.depth + 1 });
    }
  }
  const cyclic = roster.filter((p) => !depth.has(p.externalId));

  /** Everybody beneath a person, at any depth. Memoised, and cycle-safe by the
   *  same `seen` set that makes the traversal terminate. */
  const totalCache = new Map<string, number>();
  const totalBeneath = (id: string, seen: Set<string>): number => {
    if (totalCache.has(id)) return totalCache.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    let total = 0;
    for (const report of directReports.get(id) ?? []) {
      total += 1 + totalBeneath(report.externalId, seen);
    }
    totalCache.set(id, total);
    return total;
  };

  const spans: SpanRow[] = [...directReports.entries()]
    .map(([id, reports]) => {
      const manager = byId.get(id)!;
      return {
        externalId: id,
        name: manager.name,
        title: manager.title,
        department: manager.department,
        directReports: reports.length,
        totalReports: totalBeneath(id, new Set()),
        depth: depth.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.directReports - a.directReports || a.name.localeCompare(b.name));

  const maxDepth = spans.length || roster.length ? Math.max(0, ...depth.values()) : 0;
  const layers: LayerRow[] = [];
  for (let d = 0; d <= maxDepth; d += 1) {
    const atDepth = roster.filter((p) => depth.get(p.externalId) === d);
    if (!atDepth.length) continue;
    layers.push({
      depth: d,
      headcount: atDepth.length,
      managers: atDepth.filter((p) => (directReports.get(p.externalId) ?? []).length > 0).length,
      sampleTitles: [...new Set(atDepth.map((p) => p.title).filter((t): t is string => !!t))].slice(0, 5),
    });
  }

  const departmentNames = [...new Set(roster.map((p) => p.department ?? 'Unassigned'))].sort();
  const departments = departmentNames.map((department) => {
    const members = roster.filter((p) => (p.department ?? 'Unassigned') === department);
    return {
      department,
      headcount: members.length,
      managers: members.filter((p) => (directReports.get(p.externalId) ?? []).length > 0).length,
      maxDepth: Math.max(0, ...members.map((p) => depth.get(p.externalId) ?? 0)),
    };
  });

  const spanValues = spans.map((s) => s.directReports);
  const narrow = spans.filter((s) => s.directReports <= NARROW_SPAN);
  const wide = spans.filter((s) => s.directReports > wideSpan);

  const findings: OrgFinding[] = [];
  if (cyclic.length) {
    findings.push({
      code: 'reporting_cycle',
      severity: 'high',
      headline: `${cyclic.length} ${cyclic.length === 1 ? 'person is' : 'people are'} in a reporting cycle and sit under nobody.`,
      evidence: cyclic.slice(0, EVIDENCE_CAP).map((p) => `${p.name} → manager ${p.managerExternalId}`),
      count: cyclic.length,
    });
  }
  if (unresolved.length) {
    findings.push({
      code: 'unresolved_manager',
      severity: 'high',
      headline: `${unresolved.length} ${unresolved.length === 1 ? 'person names a manager who' : 'people name managers who'} are not on the roster. Every span below undercounts by that much.`,
      evidence: unresolved.slice(0, EVIDENCE_CAP).map((p) => `${p.name} → manager id "${p.managerExternalId}" not found`),
      count: unresolved.length,
    });
  }
  const trueRoots = roots.filter((p) => !unresolved.includes(p));
  if (roster.length && trueRoots.length === 0) {
    findings.push({
      code: 'no_root',
      severity: 'high',
      headline: 'Nobody on the roster is without a manager, so the reporting graph has no top.',
      evidence: [],
      count: 0,
    });
  } else if (trueRoots.length > 1) {
    findings.push({
      code: 'multiple_roots',
      severity: 'medium',
      headline: `${trueRoots.length} people report to nobody. Layers are measured from each of them separately.`,
      evidence: trueRoots.slice(0, EVIDENCE_CAP).map((p) => `${p.name}${p.title ? ` — ${p.title}` : ''}`),
      count: trueRoots.length,
    });
  }
  if (narrow.length) {
    findings.push({
      code: 'single_report_manager',
      severity: 'medium',
      headline: `${narrow.length} ${narrow.length === 1 ? 'manager has' : 'managers have'} a single report — usually a layer that exists to make a title work.`,
      evidence: narrow.slice(0, EVIDENCE_CAP).map((s) => `${s.name} → 1 report`),
      count: narrow.length,
    });
  }
  if (wide.length) {
    findings.push({
      code: 'wide_span',
      severity: 'medium',
      headline: `${wide.length} ${wide.length === 1 ? 'manager carries' : 'managers carry'} more than ${wideSpan} direct reports.`,
      evidence: wide.slice(0, EVIDENCE_CAP).map((s) => `${s.name} → ${s.directReports} direct, ${s.totalReports} total`),
      count: wide.length,
    });
  }
  // Depth is only meaningful against width. Six layers is normal at 5,000 people
  // and absurd at 40, so the finding compares the two rather than asserting a
  // universal ceiling.
  if (maxDepth >= 4 && roster.length > 0 && roster.length < Math.pow(3, maxDepth)) {
    findings.push({
      code: 'deep_org',
      severity: 'medium',
      headline: `${maxDepth + 1} layers for ${roster.length} people — deeper than this headcount needs at any reasonable span.`,
      evidence: layers.map((l) => `layer ${l.depth}: ${l.headcount} people, ${l.managers} managers`),
      count: maxDepth,
    });
  }
  const headless = departments.filter((d) => d.headcount > 1 && d.managers === 0);
  if (headless.length) {
    findings.push({
      code: 'department_without_manager',
      severity: 'low',
      headline: `${headless.length} ${headless.length === 1 ? 'department has' : 'departments have'} more than one person and nobody managing inside it.`,
      evidence: headless.slice(0, EVIDENCE_CAP).map((d) => `${d.department} — ${d.headcount} people`),
      count: headless.length,
    });
  }
  const unlabelledManagers = spans.filter((s) => !s.department);
  if (unlabelledManagers.length) {
    findings.push({
      code: 'manager_missing_department',
      severity: 'low',
      headline: `${unlabelledManagers.length} ${unlabelledManagers.length === 1 ? 'manager has' : 'managers have'} no department set, so their teams do not appear in any departmental rollup.`,
      evidence: unlabelledManagers.slice(0, EVIDENCE_CAP).map((s) => `${s.name} — ${s.directReports} reports, no department`),
      count: unlabelledManagers.length,
    });
  }

  return {
    ok: true,
    source: options.source ?? 'unknown',
    headcount: roster.length,
    managers: spans.length,
    individualContributors: roster.length - spans.length,
    managerRatio: roster.length ? spans.length / roster.length : 0,
    layers,
    maxDepth,
    averageSpan: avg(spanValues),
    medianSpan: median(spanValues),
    spans,
    departments,
    findings,
    assumptions: [
      `Terminated employees are excluded; ${people.length - roster.length} of ${people.length} rows were dropped on that basis.`,
      'A "manager" is anybody with at least one direct report on this roster — not anybody with a manager-sounding title.',
      `A span above ${wideSpan} is reported as wide and a span of ${NARROW_SPAN} as narrow. Both thresholds are conventions, not findings.`,
      'Layers are counted from each person who reports to nobody, so a roster with several such people has several depth-0 layers.',
    ],
    instruction:
      'Lead with the structural DEFECTS (cycles, unresolved managers, roots) before any span or layer commentary — a span average '
      + 'computed over a broken graph is wrong, and the reader needs to know that first. Quote the named people from `evidence`; do not '
      + 'summarise them into a count the reader cannot check. Do NOT recommend a reorganisation: a span of 3 is right for some work and '
      + 'wrong for other work, and nothing in a roster tells you which this is. Ask what the teams DO before advising anything.',
  };
}
