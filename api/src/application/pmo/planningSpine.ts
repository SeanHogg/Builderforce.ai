/**
 * Planning spine (0225) — the ONE connected hierarchy behind both the unified
 * Gantt and the CAPEX/OPEX cost rollup.
 *
 * Levels: portfolio → objective → initiative → epic → task. Unlike the legacy
 * project-join rollup, cost and classification traverse REAL parentage:
 *   - lineage edges: task.parentTaskId (epic), task.initiative_id (or its
 *     project's initiative), initiative.portfolio_id, and the objective_links
 *     table (an objective owns any mix of initiatives / epics / tasks).
 *   - CAPEX/OPEX inherits top-down (objective set → its lineage inherits); a child
 *     that manually declares the OTHER class raises an anomaly that bubbles up so a
 *     PM can reconcile it.
 *   - $ rolls bottom-up from leaf tasks (authoritative LLM spend + an estimated
 *     labour cost) to every ancestor, so cost is available AT ANY LEVEL.
 *
 * The pure core ({@link classifyCostClass}, {@link buildSpine}) is DB-free and
 * unit-testable; {@link loadPlanningSpine} just feeds it rows.
 */

import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  initiatives,
  llmUsageLog,
  memberProfiles,
  objectiveLinks,
  objectives,
  portfolios,
  projects,
  roadmapItems,
  tasks,
} from '../../infrastructure/database/schema';
import { loggedMinutesByTask } from '../timeTracking/timeTracking';
import {
  allocationCategoryLabel,
  defaultCostClassFor,
  deriveAllocationCategory,
  normalizeAllocationCategory,
  type AllocationCategory,
} from '../llm/allocationCategories';

export type CostClass = 'capex' | 'opex';
export type CostClassSource = 'manual' | 'inherited' | 'agent';
export type SpineNodeKind = 'portfolio' | 'objective' | 'initiative' | 'epic' | 'task' | 'roadmap';

const MILLICENTS_PER_USD = 100_000;
const HOUR_MS = 3_600_000;
/** Labour-hours cap per task when estimating human cost from cycle time (no
 *  effort/time-tracking field exists yet — see the roadmap gap). */
const HUMAN_HOURS_CAP = 8;

function isCostClass(v: unknown): v is CostClass {
  return v === 'capex' || v === 'opex';
}

// ── Agent cost classifier (pure) ─────────────────────────────────────────────
// CAPEX/OPEX rides the EXISTING investment-allocation taxonomy (the single source
// of truth shared with the allocation lens — DRY): a task's investment category is
// derived from its action_type + signals ({@link deriveAllocationCategory}), and
// the GAAP-conservative default class follows ({@link defaultCostClassFor}: only
// net-new development — innovation — capitalises). This matches the operator rule
// (adding capability → CAPEX, fixing/maintaining → OPEX) AND keeps the spine and
// the allocation lens in lock-step instead of inventing a second classifier.

// ── Completion percent for OKR epics (PIE-1) ──────────────────────────────────
// An OKR epic's  is handled as a taskType === 'epic'.
// Children are tasks linked via parentTaskId.
// Percent = (completed children / total children) * 100.
// 0 children → 0%; difficulty: work items may be untyped (legacy) — we treat them as children.
// If a child is also an epic, we do NOT recurse into its children (only direct task children for this metric).
const COMPLETED_STATUSES = new Set(['done', 'completed', 'closed']);
interface TaskCompletion {
  total: number;
  completed: number;
}

export interface CostClassSuggestion {
  costClass: CostClass;
  confidence: number; // 0..1
  rationale: string;
}

/** Investment category for a task/epic from its signals (shared taxonomy). */
function computeCompletionPercent(totalItems: number, completedItems: number): number | null {
  if (totalItems === 0) return 0;
  const percent = Math.round((completedItems / totalItems) * 100);
  return Math.max(0, Math.min(100, percent));
}
export function categoryOf(input: {
  title?: string | null; description?: string | null; actionType?: string | null;
  source?: string | null; allocationCategory?: string | null;
}): AllocationCategory {
  return input.allocationCategory
    ? normalizeAllocationCategory(input.allocationCategory)
    : deriveAllocationCategory(input);
}

/**
 * CAPEX/OPEX suggestion for a work item, derived through the shared allocation
 * category so it always agrees with the allocation lens. Innovation (net-new
 * value) → CAPEX; ktlo / support / tech-debt → OPEX. A stored allocation_category
 * (a PM/agent override) raises confidence.
 */
export function classifyCostClass(input: {
  title?: string | null; description?: string | null; taskType?: 'task' | 'epic' | string | null;
  actionType?: string | null; source?: string | null; allocationCategory?: string | null;
}): CostClassSuggestion {
  const category = categoryOf(input);
  const costClass = defaultCostClassFor(category);
  return {
    costClass,
    confidence: input.allocationCategory ? 0.9 : 0.6,
    rationale: costClass === 'capex'
      ? `Net-new value (${allocationCategoryLabel(category)}) — capitalisable (CAPEX).`
      : `Maintains/operates existing (${allocationCategoryLabel(category)}) — operating expense (OPEX).`,
  };
}

// ── Spine model (pure) ───────────────────────────────────────────────────────

export interface RawPortfolio { id: string; name: string; status: string; costClass: string | null; costClassSource: string }
export interface RawObjective {
  id: string; title: string; status: string;
  startDate: Date | null; endDate: Date | null;
  portfolioId: string | null; initiativeId: string | null;
  costClass: string | null; costClassSource: string;
}
export interface RawInitiative {
  id: string; name: string; status: string;
  startDate: Date | null; targetDate: Date | null;
  portfolioId: string | null;
  costClass: string | null; costClassSource: string;
}
export interface RawProject { id: number; initiativeId: string | null }
export interface RawTask {
  id: number; projectId: number; parentTaskId: number | null; initiativeId: string | null;
  taskType: 'task' | 'epic' | string; title: string; description: string | null; status: string;
  startDate: Date | null; dueDate: Date | null; createdAt: Date; completedAt: Date | null;
  assignedUserId: string | null;
  costClass: string | null; costClassSource: string; costClassVerified: boolean;
  /** Investment-allocation signals (shared taxonomy) — drive the category default. */
  actionType: string | null; source: string | null; allocationCategory: string | null;
}
export interface RawObjectiveLink { objectiveId: string; linkKind: string; initiativeId: string | null; taskId: number | null }
/** Roadmap item folded into the spine (0225/SPINE-4): targetDate-only, no cost. */
export interface RawRoadmapItem { id: string; title: string; status: string; targetDate: Date | null; projectId: number | null }
export interface RawTaskLlm { taskId: number; millicents: number }
export interface RawMemberRate { memberRef: string; costRateUsdCents: number | null }

export interface SpineCost { llmUsd: number; humanUsd: number; totalUsd: number; capexUsd: number; opexUsd: number }

export interface SpineNode {
  key: string;                 // 'portfolio:uuid' | 'objective:uuid' | 'initiative:uuid' | 'epic:12' | 'task:12'
  id: string;
  kind: SpineNodeKind;
  parentKey: string | null;
  title: string;
  status: string;
  startDate: string | null;    // ISO
  endDate: string | null;
  depth: number;
  declaredCostClass: CostClass | null;
  costClassSource: CostClassSource;
  inheritedCostClass: CostClass | null;
  effectiveCostClass: CostClass | null;
  costClassVerified: boolean;
  /** Own declared class contradicts what it would inherit — a reconcile target. */
  anomaly: boolean;
  /** Any descendant has an anomaly (so the top level "indicates an abnormality"). */
  hasDescendantAnomaly: boolean;
  /** Agent CAPEX/OPEX suggestion (tasks/epics only). */
  suggestion: CostClassSuggestion | null;
  cost: SpineCost;
  childCount: number;
  /** Percentage complete of this epic based on direct task children. */
  completionPercent: number | null;
  /** Number of direct task children that are completed (Done/Completed/Closed). */
  completedItems: number;
  /** Total number of direct task children (includes untyped/legacy items). */
  totalItems: number;
}

export interface SpineResult {
  nodes: SpineNode[];
  totals: SpineCost;
  /** Count of nodes whose declared class contradicts their inherited class. */
  anomalyCount: number;
  /** Count of task/epic nodes with no verified classification. */
  unverifiedCount: number;
}

function iso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

function emptyCost(): SpineCost {
  return { llmUsd: 0, humanUsd: 0, totalUsd: 0, capexUsd: 0, opexUsd: 0 };
}

/**
 * Assemble the spine from raw rows: compute single-parent lineage (objective
 * links win over structural parentage), resolve CAPEX/OPEX inheritance + anomaly,
 * and roll cost from leaf tasks up to every ancestor. Pure — no DB, no clock
 * except `now` for the labour estimate.
 */
export function buildSpine(input: {
  portfolios: RawPortfolio[];
  objectives: RawObjective[];
  initiatives: RawInitiative[];
  projects: RawProject[];
  tasks: RawTask[];
  links: RawObjectiveLink[];
  taskLlm: RawTaskLlm[];
  memberRates: RawMemberRate[];
  /** Real logged minutes per task (migration 0245) — authoritative over the
   *  cycle-time estimate when present. */
  loggedMinutesByTask?: Map<number, number>;
  /** Roadmap items folded in as leaf nodes (SPINE-4). */
  roadmapItems?: RawRoadmapItem[];
  /** Drop container nodes (portfolio/objective/initiative) with no leaf descendant
   *  — used by the project-scoped view (SPINE-3) so empty parents don't show. */
  prune?: boolean;
}): SpineResult {
  const projectInitiative = new Map<number, string | null>(input.projects.map((p) => [p.id, p.initiativeId]));
  const llmUsdByTask = new Map<number, number>(
    input.taskLlm.map((r) => [r.taskId, (Number(r.millicents) || 0) / MILLICENTS_PER_USD]),
  );
  const ratePerHourByMember = new Map<string, number>(
    input.memberRates
      .filter((r) => r.costRateUsdCents != null)
      .map((r) => [r.memberRef, (r.costRateUsdCents as number) / 100]),
  );

  // A node is the target of an objective link → that objective is its parent.
  const linkParent = new Map<string, string>();
  for (const l of input.links) {
    if (l.initiativeId) linkParent.set(`initiative:${l.initiativeId}`, `objective:${l.objectiveId}`);
    else if (l.taskId != null) {
      // The task key (epic vs task) is resolved once we know its type, below.
      linkParent.set(`__taskid:${l.taskId}`, `objective:${l.objectiveId}`);
    }
  }

  const nodes = new Map<string, SpineNode>();
  // GAAP category default per leaf, the final fallback when neither the node nor
  // its lineage declares a class — keeps the spine in step with the allocation lens.
  const categoryDefaultByKey = new Map<string, CostClass>();
  const declared = (v: string | null): CostClass | null => (isCostClass(v) ? v : null);
  const source = (v: string): CostClassSource =>
    v === 'manual' || v === 'agent' || v === 'inherited' ? v : 'inherited';

  // ── materialise nodes (no parentKey yet) ──────────────────────────────────
  for (const p of input.portfolios) {
    nodes.set(`portfolio:${p.id}`, baseNode('portfolio', p.id, p.name, p.status, null, null, declared(p.costClass), source(p.costClassSource), false, null));
  }
  for (const o of input.objectives) {
    nodes.set(`objective:${o.id}`, baseNode('objective', o.id, o.title, o.status, iso(o.startDate), iso(o.endDate), declared(o.costClass), source(o.costClassSource), false, null));
  }
  for (const i of input.initiatives) {
    nodes.set(`initiative:${i.id}`, baseNode('initiative', i.id, i.name, i.status, iso(i.startDate), iso(i.targetDate), declared(i.costClass), source(i.costClassSource), false, null));
  }
  for (const tk of input.tasks) {
    const kind: SpineNodeKind = tk.taskType === 'epic' ? 'epic' : 'task';
    const node = baseNode(kind, String(tk.id), tk.title, tk.status, iso(tk.startDate), iso(tk.dueDate), declared(tk.costClass), source(tk.costClassSource), tk.costClassVerified, classifyCostClass(tk));
    nodes.set(`${kind}:${tk.id}`, node);
    categoryDefaultByKey.set(`${kind}:${tk.id}`, defaultCostClassFor(categoryOf(tk)));
  }
  for (const rm of input.roadmapItems ?? []) {
    nodes.set(`roadmap:${rm.id}`, baseNode('roadmap', rm.id, rm.title, rm.status, null, iso(rm.targetDate), null, 'inherited', false, null));
  }

  // ── parentKey (single parent; objective link wins) ────────────────────────
  const keyOfTask = (id: number): string => (nodes.has(`epic:${id}`) ? `epic:${id}` : `task:${id}`);
  const exists = (k: string | null): string | null => (k && nodes.has(k) ? k : null);

  for (const p of input.portfolios) nodes.get(`portfolio:${p.id}`)!.parentKey = null;
  for (const o of input.objectives) {
    const node = nodes.get(`objective:${o.id}`)!;
    node.parentKey = exists(o.portfolioId ? `portfolio:${o.portfolioId}` : null)
      ?? exists(o.initiativeId ? `initiative:${o.initiativeId}` : null);
  }
  for (const i of input.initiatives) {
    const node = nodes.get(`initiative:${i.id}`)!;
    node.parentKey = linkParent.get(`initiative:${i.id}`) ?? exists(i.portfolioId ? `portfolio:${i.portfolioId}` : null);
  }
  for (const tk of input.tasks) {
    const node = nodes.get(keyOfTask(tk.id))!;
    const linked = linkParent.get(`__taskid:${tk.id}`);
    const structural = tk.parentTaskId != null
      ? exists(keyOfTask(tk.parentTaskId))
      : exists((tk.initiativeId ?? projectInitiative.get(tk.projectId) ?? null) ? `initiative:${tk.initiativeId ?? projectInitiative.get(tk.projectId)}` : null);
    node.parentKey = (linked && nodes.has(linked) ? linked : null) ?? structural;
  }
  for (const rm of input.roadmapItems ?? []) {
    const node = nodes.get(`roadmap:${rm.id}`)!;
    const initId = rm.projectId != null ? projectInitiative.get(rm.projectId) : null;
    node.parentKey = exists(initId ? `initiative:${initId}` : null);
  }

  // ── prune empty containers (SPINE-3 project view) ─────────────────────────
  if (input.prune) {
    const childrenOf = new Map<string | null, string[]>();
    for (const n of nodes.values()) {
      const p = n.parentKey && nodes.has(n.parentKey) ? n.parentKey : null;
      (childrenOf.get(p) ?? childrenOf.set(p, []).get(p)!).push(n.key);
    }
    const leafKinds = new Set<SpineNodeKind>(['task', 'epic', 'roadmap']);
    const keepCache = new Map<string, boolean>();
    const hasLeaf = (key: string): boolean => {
      const cached = keepCache.get(key);
      if (cached != null) return cached;
      const n = nodes.get(key)!;
      keepCache.set(key, true); // cycle backstop
      const keep = leafKinds.has(n.kind) || (childrenOf.get(key) ?? []).some(hasLeaf);
      keepCache.set(key, keep);
      return keep;
    };
    for (const key of [...nodes.keys()]) if (!hasLeaf(key)) nodes.delete(key);
  }

  // ── effective cost class (top-down, memoised, cycle-guarded) ───────────────
  const effCache = new Map<string, CostClass | null>();
  const resolving = new Set<string>();
  const effective = (key: string): CostClass | null => {
    if (effCache.has(key)) return effCache.get(key)!;
    const node = nodes.get(key);
    if (!node) return null;
    if (resolving.has(key)) return node.declaredCostClass; // cycle backstop
    resolving.add(key);
    const inherited = node.parentKey ? effective(node.parentKey) : null;
    // own declaration → lineage inheritance → GAAP category default (leaves only).
    const eff = node.declaredCostClass ?? inherited ?? categoryDefaultByKey.get(key) ?? null;
    node.inheritedCostClass = inherited;
    node.effectiveCostClass = eff;
    // Anomaly is only an own-vs-lineage contradiction — a category default never conflicts.
    node.anomaly = node.declaredCostClass != null && inherited != null && node.declaredCostClass !== inherited;
    resolving.delete(key);
    effCache.set(key, eff);
    return eff;
  };
  for (const key of nodes.keys()) effective(key);

  // ── cost rollup (bottom-up from leaf tasks) ────────────────────────────────
  const ancestorsOf = (startKey: string): string[] => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur: string | null = startKey;
    while (cur && nodes.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      chain.push(cur);
      cur = nodes.get(cur)!.parentKey;
    }
    return chain;
  };

  for (const tk of input.tasks) {
    const key = keyOfTask(tk.id);
    const node = nodes.get(key)!;
    const llmUsd = llmUsdByTask.get(tk.id) ?? 0;
    let humanUsd = 0;
    const rate = tk.assignedUserId ? ratePerHourByMember.get(tk.assignedUserId) : undefined;
    const loggedMinutes = input.loggedMinutesByTask?.get(tk.id) ?? 0;
    if (rate) {
      if (loggedMinutes > 0) {
        // REAL logged time (0245) wins — priced at the task owner's rate.
        humanUsd = rate * (loggedMinutes / 60);
      } else if (tk.completedAt) {
        // Fallback: estimate from cycle time (capped) until time is logged.
        const cycleHours = (new Date(tk.completedAt).getTime() - new Date(tk.createdAt).getTime()) / HOUR_MS;
        humanUsd = rate * Math.max(0, Math.min(cycleHours, HUMAN_HOURS_CAP));
      }
    }
    const total = llmUsd + humanUsd;
    const cls = node.effectiveCostClass;
    for (const ak of ancestorsOf(key)) {
      const c = nodes.get(ak)!.cost;
      c.llmUsd += llmUsd;
      c.humanUsd += humanUsd;
      c.totalUsd += total;
      if (cls === 'capex') c.capexUsd += total;
      else if (cls === 'opex') c.opexUsd += total;
    }
  }

  // ── child counts + anomaly bubbling ───────────────────────────────────────
  for (const node of nodes.values()) {
    if (node.parentKey && nodes.has(node.parentKey)) nodes.get(node.parentKey)!.childCount += 1;
  }
  for (const node of nodes.values()) {
    if (node.anomaly) for (const ak of ancestorsOf(node.key)) {
      if (ak !== node.key) nodes.get(ak)!.hasDescendantAnomaly = true;
    }
  }

  // ── compute completion percentage for epic nodes ( PIE-1 ) ───────────────────
  for (const node of nodes.values()) {
    if (node.kind !== 'epic') continue; // Only epics get completion metrics

    // Determine the parent key before any updates
    const parentKey = node.parentKey && nodes.has(node.parentKey) ? node.parentKey : null;

    // Only consider direct task children of this epic (not tasks of other epics)
    // We filter nodes that match this epic's key as their parent (task/epic keys resolve to the same base)
    const childKeys = nodes.entries().filter(([k, v]) => v.parentKey === `epic:${node.id}`).map(([k]) => k);

    let totalItems = 0;
    let completedItems = 0;

    for (const childKey of childKeys) {
      const child = nodes.get(childKey);
      if (child && child.kind === 'task') {  // Direct task children only (not sub-epics per the spec)
        totalItems++;
        if (COMPLETED_STATUSES.has(child.status.toLowerCase())) {
          completedItems++;
        }
      }
    }

    // Only update fields for epics with at least one direct task child
    if (totalItems > 0) {
      node.completionPercent = computeCompletionPercent(totalItems, completedItems);
      node.completedItems = completedItems;
      node.totalItems = totalItems;
    } else {
      // No direct task children configured for this epic
      node.completionPercent = 0;
      node.completedItems = 0;
      node.totalItems = 0;
    }
  }

  // ── depth (from root) ─────────────────────────────────────────────────────
  for (const node of nodes.values()) node.depth = Math.max(0, ancestorsOf(node.key).length - 1);

  const list = [...nodes.values()];
  const totals = emptyCost();
  for (const node of list) if (node.parentKey == null) {
    totals.llmUsd += node.cost.llmUsd;
    totals.humanUsd += node.cost.humanUsd;
    totals.totalUsd += node.cost.totalUsd;
    totals.capexUsd += node.cost.capexUsd;
    totals.opexUsd += node.cost.opexUsd;
  }

  return {
    nodes: list,
    totals,
    anomalyCount: list.filter((n) => n.anomaly).length,
    unverifiedCount: list.filter((n) => (n.kind === 'task' || n.kind === 'epic') && !n.costClassVerified).length,
  };
}

function baseNode(
  kind: SpineNodeKind, id: string, title: string, status: string,
  startDate: string | null, endDate: string | null,
  declaredCostClass: CostClass | null, costClassSource: CostClassSource,
  costClassVerified: boolean, suggestion: CostClassSuggestion | null,
): SpineNode {
  return {
    key: `${kind}:${id}`, id, kind, parentKey: null, title, status, startDate, endDate, depth: 0,
    declaredCostClass, costClassSource, inheritedCostClass: null, effectiveCostClass: declaredCostClass,
    costClassVerified, anomaly: false, hasDescendantAnomaly: false, suggestion,
    cost: emptyCost(), childCount: 0,
    completionPercent: null, completedItems: 0, totalItems: 0,
  };
}

// ── DB loader ────────────────────────────────────────────────────────────────

export interface SpineLoadOpts {
  /** Restrict the leaf set to one project (SPINE-3); empty containers are pruned. */
  projectId?: number;
  /** Bound LLM spend + logged time to a date window for period reporting (SPINE-5). */
  window?: { from: string; to: string };
}

/** Load every spine input for a tenant/segment and assemble the spine. */
export async function loadPlanningSpine(db: Db, tenantId: number, segmentId: string, opts: SpineLoadOpts = {}): Promise<SpineResult> {
  const [pfRows, objRows, initRows, projRows, taskRows, linkRows, roadmapRows] = await Promise.all([
    db.select({ id: portfolios.id, name: portfolios.name, status: portfolios.status, costClass: portfolios.costClass, costClassSource: portfolios.costClassSource })
      .from(portfolios).where(and(eq(portfolios.tenantId, tenantId), eq(portfolios.segmentId, segmentId))),
    db.select({ id: objectives.id, title: objectives.title, status: objectives.status, startDate: objectives.startDate, endDate: objectives.endDate, portfolioId: objectives.portfolioId, initiativeId: objectives.initiativeId, costClass: objectives.costClass, costClassSource: objectives.costClassSource })
      .from(objectives).where(and(eq(objectives.tenantId, tenantId), eq(objectives.segmentId, segmentId))),
    db.select({ id: initiatives.id, name: initiatives.name, status: initiatives.status, startDate: initiatives.startDate, targetDate: initiatives.targetDate, portfolioId: initiatives.portfolioId, costClass: initiatives.costClass, costClassSource: initiatives.costClassSource })
      .from(initiatives).where(and(eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, segmentId))),
    db.select({ id: projects.id, initiativeId: projects.initiativeId })
      .from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.segmentId, segmentId))),
    db.select({
      id: tasks.id, projectId: tasks.projectId, parentTaskId: tasks.parentTaskId, initiativeId: tasks.initiativeId,
      taskType: tasks.taskType, title: tasks.title, description: tasks.description, status: tasks.status,
      startDate: tasks.startDate, dueDate: tasks.dueDate, createdAt: tasks.createdAt, completedAt: tasks.completedAt,
      assignedUserId: tasks.assignedUserId, costClass: tasks.costClass, costClassSource: tasks.costClassSource, costClassVerified: tasks.costClassVerified,
      actionType: tasks.actionType, source: tasks.source, allocationCategory: tasks.allocationCategory,
    }).from(tasks).where(opts.projectId != null ? and(eq(tasks.segmentId, segmentId), eq(tasks.projectId, opts.projectId)) : eq(tasks.segmentId, segmentId)),
    db.select({ objectiveId: objectiveLinks.objectiveId, linkKind: objectiveLinks.linkKind, initiativeId: objectiveLinks.initiativeId, taskId: objectiveLinks.taskId })
      .from(objectiveLinks).where(and(eq(objectiveLinks.tenantId, tenantId), eq(objectiveLinks.segmentId, segmentId))),
    db.select({ id: roadmapItems.id, title: roadmapItems.title, status: roadmapItems.status, targetDate: roadmapItems.targetDate, projectId: roadmapItems.projectId })
      .from(roadmapItems).where(opts.projectId != null ? and(eq(roadmapItems.tenantId, tenantId), eq(roadmapItems.segmentId, segmentId), eq(roadmapItems.projectId, opts.projectId)) : and(eq(roadmapItems.tenantId, tenantId), eq(roadmapItems.segmentId, segmentId))),
  ]);

  const taskIds = taskRows.map((t) => t.id);
  const llmWhere = opts.window
    ? and(eq(llmUsageLog.tenantId, tenantId), inArray(llmUsageLog.taskId, taskIds), gte(llmUsageLog.createdAt, new Date(opts.window.from)), lte(llmUsageLog.createdAt, new Date(`${opts.window.to}T23:59:59.999Z`)))
    : and(eq(llmUsageLog.tenantId, tenantId), inArray(llmUsageLog.taskId, taskIds));
  const [llmRows, rateRows, loggedMin] = await Promise.all([
    taskIds.length
      ? db.select({ taskId: llmUsageLog.taskId, millicents: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}),0)` })
          .from(llmUsageLog).where(llmWhere).groupBy(llmUsageLog.taskId)
      : Promise.resolve([] as Array<{ taskId: number | null; millicents: string }>),
    db.select({ memberRef: memberProfiles.memberRef, costRateUsdCents: memberProfiles.costRateUsdCents })
      .from(memberProfiles)
      .where(and(eq(memberProfiles.tenantId, tenantId), eq(memberProfiles.memberKind, 'human'))),
    loggedMinutesByTask(db, tenantId, taskIds, opts.window),
  ]);

  return buildSpine({
    portfolios: pfRows,
    objectives: objRows,
    initiatives: initRows,
    projects: projRows,
    tasks: taskRows as RawTask[],
    links: linkRows,
    taskLlm: llmRows.filter((r) => r.taskId != null).map((r) => ({ taskId: r.taskId as number, millicents: Number(r.millicents) })),
    memberRates: rateRows,
    loggedMinutesByTask: loggedMin,
    roadmapItems: roadmapRows,
    prune: opts.projectId != null,
  });
}

/**
 * Tenant-wide map of task id → effective CAPEX/OPEX class, resolved through the
 * SAME lineage rules as the spine (own → ancestor objective/initiative → category
 * default). Lets the allocation lens (which is tenant-scoped, not segment-scoped)
 * honour lineage inheritance instead of only own-or-category — closing SPINE-2.
 * Cost/date inputs are skipped (classification only), so it's a light read.
 */
export async function loadTaskCostClassMap(db: Db, tenantId: number): Promise<Map<number, CostClass>> {
  const [objRows, initRows, projRows, taskRows, linkRows] = await Promise.all([
    db.select({ id: objectives.id, title: objectives.title, status: objectives.status, startDate: objectives.startDate, endDate: objectives.endDate, portfolioId: objectives.portfolioId, initiativeId: objectives.initiativeId, costClass: objectives.costClass, costClassSource: objectives.costClassSource })
      .from(objectives).where(eq(objectives.tenantId, tenantId)),
    db.select({ id: initiatives.id, name: initiatives.name, status: initiatives.status, startDate: initiatives.startDate, targetDate: initiatives.targetDate, portfolioId: initiatives.portfolioId, costClass: initiatives.costClass, costClassSource: initiatives.costClassSource })
      .from(initiatives).where(eq(initiatives.tenantId, tenantId)),
    db.select({ id: projects.id, initiativeId: projects.initiativeId }).from(projects).where(eq(projects.tenantId, tenantId)),
    db.select({
      id: tasks.id, projectId: tasks.projectId, parentTaskId: tasks.parentTaskId, initiativeId: tasks.initiativeId,
      taskType: tasks.taskType, title: tasks.title, description: tasks.description, status: tasks.status,
      startDate: tasks.startDate, dueDate: tasks.dueDate, createdAt: tasks.createdAt, completedAt: tasks.completedAt,
      assignedUserId: tasks.assignedUserId, costClass: tasks.costClass, costClassSource: tasks.costClassSource, costClassVerified: tasks.costClassVerified,
      actionType: tasks.actionType, source: tasks.source, allocationCategory: tasks.allocationCategory,
    }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(eq(projects.tenantId, tenantId)),
    db.select({ objectiveId: objectiveLinks.objectiveId, linkKind: objectiveLinks.linkKind, initiativeId: objectiveLinks.initiativeId, taskId: objectiveLinks.taskId })
      .from(objectiveLinks).where(eq(objectiveLinks.tenantId, tenantId)),
  ]);
  const spine = buildSpine({
    portfolios: [], objectives: objRows, initiatives: initRows, projects: projRows,
    tasks: taskRows as RawTask[], links: linkRows, taskLlm: [], memberRates: [],
  });
  const map = new Map<number, CostClass>();
  for (const n of spine.nodes) {
    if ((n.kind === 'task' || n.kind === 'epic') && n.effectiveCostClass) map.set(Number(n.id), n.effectiveCostClass);
  }
  return map;
}
