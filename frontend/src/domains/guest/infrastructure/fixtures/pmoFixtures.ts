/**
 * Wire adapters for the PLANNING reads — `/api/pmo/*`.
 *
 * The tree, the value stream, the planning spine and the four segment trackers
 * (portfolios, initiatives, objectives, key results) all describe ONE hierarchy,
 * declared once in `domain/samplePlanning`. Each entry below projects it onto
 * the exact response type its client in `lib/builderforceApi.ts` returns, so a
 * shape change there is a type error here rather than an empty chart.
 *
 * Delivery progress and cost are DERIVED from the sample tickets — the same rows
 * the board renders — so the value stream's "40% complete" is the board's own
 * count, not a typed figure that argues with it.
 *
 * `pmo.rollup` stays with the money lenses (`financeFixtures`): it is a spend
 * and throughput roll-up and shares their window and cents→dollars helpers.
 */

import type {
  CostClass,
  Initiative,
  KeyResult,
  Objective,
  Portfolio,
  PmoTree,
  SpineCost,
  SpineNode,
  SpineNodeKind,
  SpineResult,
  ValueStream,
} from '@/lib/builderforceApi';
import { isSampleTaskCompleted, SAMPLE_MEMBERS, sampleTaskId, type SampleTask } from '../../domain/sampleWorkspace';
import {
  SAMPLE_DEPENDENCIES,
  SAMPLE_INITIATIVES,
  SAMPLE_KEY_RESULTS,
  SAMPLE_OBJECTIVES,
  SAMPLE_PORTFOLIO,
  type SampleInitiative,
} from '../../domain/samplePlanning';
import { dayOffsetToIso, exact, type GuestFixture, type GuestFixtureContext } from '../../domain/guestFixture';

/** `YYYY-MM-DD` for a day offset — the date-only shape every PMO date travels in. */
const dateOf = (now: number, offset: number): string => dayOffsetToIso(now, offset).slice(0, 10);

/** `YYYY-Qn` for the read's own clock, offset by some days. */
function quarterOf(now: number, offset: number): string {
  const date = new Date(now + offset * 86_400_000);
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** Initiative start = the project's own start; nothing else dates it. */
const initiativeStart = (initiative: SampleInitiative) => initiative.project.createdDayOffset;

// ---------------------------------------------------------------------------
// Delivery progress per initiative — one derivation, read by the value stream
// ---------------------------------------------------------------------------

function initiativeProgress(initiative: SampleInitiative) {
  const work = initiative.project.tasks.filter((task) => !task.epic);
  const completed = work.filter((task) => isSampleTaskCompleted(task.status)).length;
  return {
    totalTasks: work.length,
    completedTasks: completed,
    completionPct: work.length === 0 ? 0 : Math.round((completed / work.length) * 100),
  };
}

/** Initiatives in dependency order — the sample graph is a single chain, so the
 *  critical path is the chain itself, walked from the initiative nothing blocks. */
function criticalPath(): string[] {
  if (SAMPLE_DEPENDENCIES.length === 0) return [];
  const blocked = new Set(SAMPLE_DEPENDENCIES.map((edge) => edge.toInitiativeId));
  const next = new Map(SAMPLE_DEPENDENCIES.map((edge) => [edge.fromInitiativeId, edge.toInitiativeId]));
  const start = SAMPLE_DEPENDENCIES.map((edge) => edge.fromInitiativeId).find((id) => !blocked.has(id));
  const path: string[] = [];
  for (let id = start; id && !path.includes(id); id = next.get(id)) path.push(id);
  return path;
}

function valueStream(): ValueStream {
  const path = criticalPath();
  const onPath = new Set(path);
  const pairs = new Set(path.slice(1).map((id, index) => `${path[index]}→${id}`));
  return {
    nodes: SAMPLE_INITIATIVES.map((initiative) => ({
      id: initiative.id,
      name: initiative.project.name,
      status: initiative.project.status,
      onCriticalPath: onPath.has(initiative.id),
      blockedBy: SAMPLE_DEPENDENCIES
        .filter((edge) => edge.toInitiativeId === initiative.id)
        .map((edge) => edge.fromInitiativeId),
      ...initiativeProgress(initiative),
    })),
    edges: SAMPLE_DEPENDENCIES.map((edge) => ({
      ...edge,
      onCriticalPath: pairs.has(`${edge.fromInitiativeId}→${edge.toInitiativeId}`),
    })),
    criticalPath: path,
    cycleDetected: false,
  };
}

// ---------------------------------------------------------------------------
// The planning spine — portfolio → objective → initiative → epic → task
// ---------------------------------------------------------------------------

/** What a story point costs, by who does it. Agents bill model spend; people
 *  bill hours (four an estimate point, at a blended rate). */
const AGENT_USD_PER_POINT = 6;
const HUMAN_USD_PER_POINT = 4 * 85;
const AGENT_SLUGS: ReadonlySet<string> = new Set(
  SAMPLE_MEMBERS.filter((member) => member.kind === 'agent').map((member) => member.slug),
);

const zeroCost = (): SpineCost => ({ llmUsd: 0, humanUsd: 0, totalUsd: 0, capexUsd: 0, opexUsd: 0 });

function taskCost(task: SampleTask, costClass: CostClass): SpineCost {
  const points = task.points ?? 0;
  const byAgent = AGENT_SLUGS.has(task.assignee);
  const llmUsd = byAgent ? points * AGENT_USD_PER_POINT : 0;
  const humanUsd = byAgent ? 0 : points * HUMAN_USD_PER_POINT;
  const totalUsd = llmUsd + humanUsd;
  return {
    llmUsd, humanUsd, totalUsd,
    capexUsd: costClass === 'capex' ? totalUsd : 0,
    opexUsd: costClass === 'opex' ? totalUsd : 0,
  };
}

function addCost(into: SpineCost, from: SpineCost): void {
  into.llmUsd += from.llmUsd;
  into.humanUsd += from.humanUsd;
  into.totalUsd += from.totalUsd;
  into.capexUsd += from.capexUsd;
  into.opexUsd += from.opexUsd;
}

function node(
  kind: SpineNodeKind,
  id: string,
  parentKey: string | null,
  title: string,
  status: string,
  dates: { start: string | null; end: string | null; derived: boolean },
  costClass: { declared: CostClass | null; inherited: CostClass | null },
): SpineNode {
  const effective = costClass.declared ?? costClass.inherited;
  return {
    key: `${kind}:${id}`, id, kind, parentKey, title, status,
    startDate: dates.start, endDate: dates.end, depth: 0,
    datesDerived: dates.derived,
    notYetScoped: false,
    decompositionSource: kind === 'epic' ? 'manual' : null,
    planVerdict: null,
    dependsOn: [],
    declaredCostClass: costClass.declared,
    costClassSource: costClass.declared ? 'manual' : 'inherited',
    inheritedCostClass: costClass.inherited,
    effectiveCostClass: effective,
    // Containers are classified by a person; tickets inherit and are verified
    // once they are done — so the reconcile view has something left to confirm.
    costClassVerified: kind !== 'task' && kind !== 'epic',
    anomaly: false,
    hasDescendantAnomaly: false,
    suggestion: null,
    cost: zeroCost(),
    childCount: 0,
  };
}

function spine({ now, query }: GuestFixtureContext): SpineResult {
  // `?project=` scopes the LEAF set to one project; parents with nothing left
  // under them are pruned, exactly as the server does.
  const wanted = query.get('project');
  const initiatives = wanted
    ? SAMPLE_INITIATIVES.filter((initiative) => String(initiative.project.id) === wanted)
    : SAMPLE_INITIATIVES;

  const nodes: SpineNode[] = [];
  const portfolioKey = `portfolio:${SAMPLE_PORTFOLIO.id}`;
  const portfolio = node('portfolio', SAMPLE_PORTFOLIO.id, null, SAMPLE_PORTFOLIO.name, SAMPLE_PORTFOLIO.status,
    { start: null, end: dateOf(now, SAMPLE_PORTFOLIO.targetDayOffset), derived: false },
    { declared: null, inherited: null });
  nodes.push(portfolio);

  const objectiveByInitiative = new Map(SAMPLE_OBJECTIVES.map((objective) => [objective.initiativeId, objective]));
  const objectiveNodes = new Map<string, SpineNode>();

  for (const initiative of initiatives) {
    const objective = objectiveByInitiative.get(initiative.id);
    let parentKey = portfolioKey;
    if (objective) {
      let objectiveNode = objectiveNodes.get(objective.id);
      if (!objectiveNode) {
        objectiveNode = node('objective', objective.id, portfolioKey, objective.title, 'active',
          { start: dateOf(now, objective.startDayOffset), end: dateOf(now, objective.endDayOffset), derived: false },
          { declared: null, inherited: null });
        objectiveNodes.set(objective.id, objectiveNode);
        nodes.push(objectiveNode);
      }
      parentKey = objectiveNode.key;
    }

    const initiativeNode = node('initiative', initiative.id, parentKey, initiative.project.name, initiative.project.status,
      { start: dateOf(now, initiativeStart(initiative)), end: dateOf(now, initiative.targetDayOffset), derived: false },
      { declared: initiative.costClass, inherited: null });
    // The value stream's edge, drawn as a Gantt arrow — only to an initiative
    // still in scope, so a project-scoped spine never points at a pruned row.
    initiativeNode.dependsOn = SAMPLE_DEPENDENCIES
      .filter((edge) => edge.toInitiativeId === initiative.id && initiatives.some((i) => i.id === edge.fromInitiativeId))
      .map((edge) => `initiative:${edge.fromInitiativeId}`);
    nodes.push(initiativeNode);

    const project = initiative.project;
    for (const task of project.tasks) {
      const parent = task.parentKey ? project.tasks.find((t) => t.key === task.parentKey) : undefined;
      const taskParentKey = parent ? `epic:${sampleTaskId(project, parent)}` : initiativeNode.key;
      const end = task.completedDayOffset ?? task.dueDayOffset;
      const leaf = node(task.epic ? 'epic' : 'task', String(sampleTaskId(project, task)), taskParentKey, task.title, task.status,
        { start: dateOf(now, task.createdDayOffset), end: end == null ? null : dateOf(now, end), derived: false },
        { declared: null, inherited: initiative.costClass });
      leaf.costClassVerified = isSampleTaskCompleted(task.status);
      if (!task.epic) leaf.cost = taskCost(task, initiative.costClass);
      nodes.push(leaf);
    }
  }

  // Roll cost, child counts and depth up the tree — deepest first, so a parent
  // sums children that have already summed theirs.
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const depthOf = (n: SpineNode): number => (n.parentKey && byKey.has(n.parentKey) ? depthOf(byKey.get(n.parentKey)!) + 1 : 0);
  for (const n of nodes) n.depth = depthOf(n);
  for (const n of [...nodes].sort((a, b) => b.depth - a.depth)) {
    const parent = n.parentKey ? byKey.get(n.parentKey) : undefined;
    if (!parent) continue;
    parent.childCount += 1;
    addCost(parent.cost, n.cost);
  }
  // The portfolio has no start of its own; it spans its earliest child.
  const starts = nodes.filter((n) => n.parentKey === portfolioKey && n.startDate).map((n) => n.startDate!);
  if (starts.length > 0) {
    portfolio.startDate = starts.sort()[0]!;
    portfolio.datesDerived = true;
  }

  const totals = zeroCost();
  for (const n of nodes) if (n.parentKey == null) addCost(totals, n.cost);
  return {
    nodes,
    totals,
    anomalyCount: nodes.filter((n) => n.anomaly).length,
    unverifiedCount: nodes.filter((n) => (n.kind === 'task' || n.kind === 'epic') && !n.costClassVerified).length,
  };
}

// ---------------------------------------------------------------------------
// The registry entries
// ---------------------------------------------------------------------------

export const pmoFixtures: GuestFixture[] = [
  {
    id: 'pmo.tree',
    match: exact('/api/pmo/tree'),
    respond: ({ now }): PmoTree => ({
      portfolios: [{
        id: SAMPLE_PORTFOLIO.id,
        name: SAMPLE_PORTFOLIO.name,
        description: SAMPLE_PORTFOLIO.description,
        status: SAMPLE_PORTFOLIO.status,
        targetDate: dateOf(now, SAMPLE_PORTFOLIO.targetDayOffset),
      }],
      initiatives: SAMPLE_INITIATIVES.map((initiative) => ({
        id: initiative.id,
        name: initiative.project.name,
        description: initiative.project.description,
        status: initiative.project.status,
        portfolioId: initiative.portfolioId,
        targetDate: dateOf(now, initiative.targetDayOffset),
        projectCount: 1,
      })),
      projects: SAMPLE_INITIATIVES.map((initiative) => ({
        id: initiative.project.id,
        name: initiative.project.name,
        key: initiative.project.key,
        status: initiative.project.status,
        initiativeId: initiative.id,
      })),
      dependencies: SAMPLE_DEPENDENCIES.map((edge) => ({ ...edge })),
    }),
  },
  {
    id: 'pmo.valueStream',
    match: exact('/api/pmo/value-stream'),
    respond: (): ValueStream => valueStream(),
  },
  {
    id: 'pmo.spine',
    match: exact('/api/pmo/spine'),
    respond: (context): SpineResult => spine(context),
  },
  {
    id: 'pmo.portfolios',
    match: exact('/api/pmo/portfolios'),
    respond: ({ now }): Portfolio[] => [{
      id: SAMPLE_PORTFOLIO.id,
      name: SAMPLE_PORTFOLIO.name,
      description: SAMPLE_PORTFOLIO.description,
      status: SAMPLE_PORTFOLIO.status,
      ownerUserId: null,
      targetDate: dateOf(now, SAMPLE_PORTFOLIO.targetDayOffset),
    }],
  },
  {
    id: 'pmo.initiatives',
    match: exact('/api/pmo/initiatives'),
    respond: ({ now }): Initiative[] => SAMPLE_INITIATIVES.map((initiative) => ({
      id: initiative.id,
      name: initiative.project.name,
      description: initiative.project.description,
      status: initiative.project.status,
      portfolioId: initiative.portfolioId,
      ownerUserId: null,
      startDate: dateOf(now, initiativeStart(initiative)),
      targetDate: dateOf(now, initiative.targetDayOffset),
      costClass: initiative.costClass,
      costClassSource: 'manual',
    })),
  },
  {
    id: 'pmo.objectives',
    match: exact('/api/pmo/objectives'),
    respond: ({ now }): Objective[] => SAMPLE_OBJECTIVES.map((objective) => {
      const initiative = SAMPLE_INITIATIVES.find((i) => i.id === objective.initiativeId);
      return {
        id: objective.id,
        title: objective.title,
        description: objective.description,
        period: quarterOf(now, objective.startDayOffset),
        status: 'active',
        projectId: initiative?.project.id ?? null,
        portfolioId: objective.portfolioId,
        initiativeId: objective.initiativeId,
        ownerUserId: null,
        startDate: dateOf(now, objective.startDayOffset),
        endDate: dateOf(now, objective.endDayOffset),
        costClass: initiative?.costClass ?? null,
        costClassSource: 'inherited',
      };
    }),
  },
  {
    id: 'pmo.keyResults',
    match: exact('/api/pmo/key-results'),
    respond: (): KeyResult[] => SAMPLE_KEY_RESULTS.map((kr) => ({
      id: kr.id,
      objectiveId: kr.objectiveId,
      title: kr.title,
      metricType: kr.metricType,
      startValue: kr.startValue,
      targetValue: kr.targetValue,
      currentValue: kr.currentValue,
      unit: kr.unit,
      status: 'on_track',
    })),
  },
];
