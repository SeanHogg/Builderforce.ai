/**
 * Scoring rules for the 6-dimension Project Health Scorecard.
 *
 * A diagnostic engine, not a planning engine — it reads data and produces
 * scores. The implementation uses factor groups; each dimension may have several
 * factors (e.g., schedule has deadlines and velocity). Each Factor is pure over
 * data and can be unit-tested.
 */

import { clampScore } from '../../shared/numbers';
import type {
  DimensionScore,
  DimensionKey,
  EvidenceItem,
  HealthBand,
} from './types';

/** Data shape expected for schedule. The engine verifies existence and relevance. */
export interface ScheduleData {
  /** Number of tasks marked overdue by Ongoing work > target_velocity delta. */
  overdueTasks: number | null;
  /** Number of tasks marked done this week. */
  weeklyCompletedTasks: number | null;
  /** Number of tasks in progress (unique IDs). */
  activeTasks: number | null;
  /** Current slated finish date string. */
  targetCompletionDate: string | null;
  /** Smoothed velocity delta over the last 14 days (tasks/week). */
  velocityDelta: number | null;
  /** Number of milestones in the next 7 days. */
  nearTermMilestonesCount: number | null;
  /** Smoothed velocity delta over the last 14 days (tasks/week). */
  velocityDelta2: number | null;
}

/**
 * Evaluate schedule dimension.
 *
 * Returns `[score, evidence, flags]` where score is 0–100.
 */
export function evaluateSchedule(data: ScheduleData): DimensionScore {
  const flags: string[] = [];
  const evidence: EvidenceItem[] = [];

  const safe = (v: number | null, key: string): number => {
    if (v === null) {
      flags.push('missing_schedule_' + key);
      evidence.push({ key: key + '_missing', label: key + ' not available', value: 'N/A' });
      return 100; // default to neutral
    }
    return v;
  };

  const overdueTasks = safe(data.overdueTasks, 'overdueTasks');
  const weeklyCompletedTasks = safe(data.weeklyCompletedTasks, 'weeklyCompletedTasks');
  const activeTasks = safe(data.activeTasks, 'activeTasks');
  const targetCompletionDate = safe(Number(data.targetCompletionDate ?? '') || 0, 'targetCompletionDate');
  const velocityDelta = safe(data.velocityDelta, 'velocityDelta');
  const nearTermMilestonesCount = safe(data.nearTermMilestonesCount, 'nearTermMilestonesCount');
  const velocityDelta2 = safe(data.velocityDelta2, 'velocityDelta2');

  // Evidence for deadline health
  const [pctNearTarget, nearTargetEv] = targetCompletionDate === 100
    ? [100, { key: 'deadline_offset', label: 'Deadline health (offset)', value: 'Not set' }]
    : ([max(0, min(100, targetCompletionDate)), { key: 'deadline_offset', label: 'Deadline health (offset)', value: `${targetCompletionDate} days` }]);

  evidence.push(nearTargetEv);

  // Evidence for velocity
  if (weeklyCompletedTasks !== null && activeTasks !== null && activeTasks > 0) {
    const weeklyProgress = (weeklyCompletedTasks / activeTasks) * 100;
    evidence.push({
      key: 'weekly_progress',
      label: 'Weekly progress (completed/all active)',
      value: `${weeklyProgress.toFixed(1)}%`,
    });
  } else {
    evidence.push({
      key: 'weekly_progress',
      label: 'Weekly progress (completed/all active)',
      value: 'N/A',
    });
  }

  // Evidence for timeline
  const overdueFlag = overdueTasks > 10 ? flags.push('many_overdue') : 0;

  // Compute base score as weighted average of progressing factors (rough)
  const totalBase = clampScore(
    (.6 * (pctNearTarget / 100)) + // 60% deadline factor
    (.3 * (weeklyProgress ?? 0) / 100) + // 30% velocity factor
    (.1 * (nearTermMilestonesCount ?? 0) / 100), // 10% milestones factor
  );

  const band = determineBand(totalBase);

  return { score: totalBase, band, evidence, flags };
}

/** Evidence for quality dimension. */
export interface QualityData {
  /** Number of open QA findings within the configured window. */
  openFindingsCount: number | null;
  /** Smoothing factor to aggregate activity; can be high. */
  smoothingFactor: number | null;
  /** Number of tests passing (as fraction). */
  testPassRatio: number | null;
  /** Number of tickets with "new" status. */
  newTicketsCount: number | null;
}

export function evaluateQuality(data: QualityData): DimensionScore {
  const flags: string[] = [];
  const evidence: EvidenceItem[] = [];

  const safe = (v: number | null, key: string): number => {
    if (v === null) {
      flags.push('missing_quality_' + key);
      evidence.push({ key: key + '_missing', label: key + ' not available', value: 'N/A' });
      return 100;
    }
    return v;
  };

  const openFindingsCount = safe(data.openFindingsCount, 'openFindingsCount');
  const smoothingFactor = safe(data.smoothingFactor, 'smoothingFactor');
  const testPassRatio = safe(data.testPassRatio, 'testPassRatio');
  const newTicketsCount = safe(data.newTicketsCount, 'newTicketsCount');

  // Evidence summary
  evidence.push({
    key: 'open_findings',
    label: 'Open QA findings',
    value: openFindingsCount.toString(),
  });

  evidence.push({
    key: 'new_tickets',
    label: 'Tickets marked "new"',
    value: newTicketsCount.toString(),
  });

  const passEvidence = testPassRatio !== null && testPassRatio !== undefined
    ? { key: 'test_pass_rate', label: 'Test passing ratio', value: `${(testPassRatio * 100).toFixed(1)}%` }
    : { key: 'test_pass_rate', label: 'Test passing ratio', value: 'N/A' };

  evidence.push(passEvidence);

  // Quality score: Smoothing factor >= 75% passes X; penalty for open findings
  let metric = smoothingFactor ?? 0;
  if (testPassRatio !== null && testPassRatio !== undefined && testPassRatio !== 0) {
    metric += testPassRatio / 2; // Factor 0.5 for test pass rate
  }
  if (openFindingsCount > 20) {
    metric -= 10;
  }

  let qualityScore = clampScore(metric / 100);
  qualityScore = clampScore(Math.max(0, Math.min(100, qualityScore)));

  const band = determineBand(qualityScore);

  return { score: qualityScore, band, evidence, flags };
}

/** Evidence for budget dimension. */
export interface BudgetData {
  /** Planned budget amount. */
  plannedBudget: number | null;
  /** Actual outgoings (ints) as fraction of planned. */
  spendingRatio: number | null;
  /** Smoothed burn rate (units per time). */
  burnRate: number | null;
  /** Burn rate can be high (positive impact), but only if < planningConstraints. */
  burnRateLowEnoughToTrust: boolean | null;
}

export function evaluateBudget(data: BudgetData): DimensionScore {
  const flags: string[] = [];
  const evidence: EvidenceItem[] = [];

  const safe = (v: number | null, key: string): number => {
    if (v === null) {
      flags.push('missing_budget_' + key);
      evidence.push({ key: key + '_missing', label: key + ' not available', value: 'N/A' });
      return 100;
    }
    return v;
  };

  const plannedBudget = safe(data.plannedBudget, 'plannedBudget');
  const spendingRatio = safe(data.spendingRatio, 'spendingRatio');
  const burnRate = safe(data.burnRate, 'burnRate');
  const burnRateLowEnoughToTrust = safe(1, 'burnRateLowEnoughToTrust') === 1 ? data.burnRateLowEnoughToTrust ?? true : true;

  // Evidence
  if (plannedBudget > 0) {
    evidence.push({
      key: 'planned_budget',
      label: 'Planned budget',
      value: `$${plannedBudget}`,
    });
  }

  evidence.push({
    key: 'spending_ratio',
    label: 'Spend ratio (actual/planned)',
    value: spendingRatio !== null ? `${spendingRatio.toFixed(2)}` : 'N/A',
  });

  evidence.push({
    key: 'burn_rate',
    label: 'Current burn rate',
    value: burnRate !== null ? `${burnRate}` : 'N/A',
  });

  const burnRateEvidence = burnRateLowEnoughToTrust
    ? { key: 'burn_rate_ok', label: 'Burn rate within constraint', value: 'Yes' }
    : { key: 'burn_rate_warning', label: 'Burn rate exceeds constraint', value: 'No' };

  evidence.push(burnRateEvidence);

  // Budget score
  let burnRateMetric = burnRateLowEnoughToTrust ? 1 : 0.5; // 1 if OK, 0.5 if warning
  let budgetScore = spendingRatio * burnRateMetric; // primary factor
  budgetScore = clampScore(Math.max(0, Math.min(100, budgetScore)));

  const band = determineBand(budgetScore);
  return { score: budgetScore, band, evidence, flags };
}

/** Evidence for scope dimension. */
export interface ScopeData {
  /** Number of completed or cancelled tasks. */
  completedOrCancelledTasks: number | null;
  /** Number of newly opened tasks within the configured window. */
  newTasksCount: number | null;
  /** Smoothed rate of opening tasks (tasks/day). */
  newTaskRate: number | null;
  /** Smoothed rate of closing tasks (tasks/day). */
  closeTaskRate: number | null;
  /** Number of epic sections planned, counted as completed if not in scope. */
  epicSections Planned: number | null;
  /** Newly created: refined in wording. */
  newEpicsCount: number | null;
}

export function evaluateScope(data: ScopeData): DimensionScore {
  const flags: string[] = [];
  const evidence: EvidenceItem[] = [];

  const safe = (v: number | null, key: string): number => {
    if (v === null) {
      flags.push('missing_scope_' + key);
      evidence.push({ key: key + '_missing', label: key + ' not available', value: 'N/A' });
      return 100;
    }
    return v;
  };

  const completedOrCancelledTasks = safe(data.completedOrCancelledTasks, 'completedOrCancelledTasks');
  const newTasksCount = safe(data.newTasksCount, 'newTasksCount');
  const newTaskRate = safe(data.newTaskRate, 'newTaskRate');
  const closeTaskRate = safe(data.closeTaskRate, 'closeTaskRate');
  const epicSectionsPlanned = safe(data['epicSections Planned'], 'epicSectionsPlanned');
  const newEpicsCount = safe(data.newEpicsCount, 'newEpicsCount');

  // Evidence summary
  evidence.push({
    key: 'completed_or_cancelled_tasks',
    label: 'Completed or cancelled tasks',
    value: completedOrCancelledTasks.toString(),
  });

  evidence.push({
    key: 'new_tasks_count',
    label: 'Newly opened tasks',
    value: newTasksCount.toString(),
  });

  evidence.push({
    key: 'close_task_rate',
    label: 'Tasks closed per day',
    value: closeTaskRate !== null ? `${closeTaskRate}` : 'N/A',
  });

  evidence.push({
    key: 'new_task_rate',
    label: 'New tasks per day',
    value: newTaskRate !== null ? `${newTaskRate}` : 'N/A',
  });

  evidence.push({
    key: 'epic_sections_planned',
    label: 'Epic sections planned',
    value: epicSectionsPlanned.toString(),
  });

  evidence.push({
    key: 'new_epics_count',
    label: 'New epics count',
    value: newEpicsCount.toString(),
  });

  const scopeScore = clampScore(85); // Placeholder; will compute actual using the suggested factors once data arrives

  const band = determineBand(scopeScore);
  return { score: scopeScore, band, evidence, flags };
}

/** Evidence for team dimension. */
export interface TeamData {
  /** Number of agents currently assigned to work items at all levels. */
  totalAgentsInUse: number | null;
  /** Number of agents that have at least one open task. */
  agentsWithOpenTasks: number | null;
  /** Number of agents assigned (n endpoints = n agents). */
  agentsAssigned: number | null;
  /** Fraction of assignments assigned. */
  assignmentsAssigned: number | null;
  /** Fraction of all work items currently assigned. */
  workItemsAssigned: number | null;
}

export function evaluateTeam(data: TeamData): DimensionScore {
  const flags: string[] = [];
  const evidence: EvidenceItem[] = [];

  const safe = (v: number | null, key: string): number => {
    if (v === null) {
      flags.push('missing_team_' + key);
      evidence.push({ key: key + '_missing', label: key + ' not available', value: 'N/A' });
      return 100;
    }
    return v;
  };

  const totalAgentsInUse = safe(data.totalAgentsInUse, 'totalAgentsInUse');
  const agentsWithOpenTasks = safe(data.agentsWithOpenTasks, 'agentsWithOpenTasks');
  const agentsAssigned = safe(data.agentsAssigned, 'agentsAssigned');
  const assignmentsAssigned = safe(data.assignmentsAssigned, 'assignmentsAssigned');
  const workItemsAssigned = safe(data.workItemsAssigned, 'workItemsAssigned');

  // Evidence summary
  evidence.push({
    key: 'total_agents_in_use',
    label: 'Agents in use',
    value: totalAgentsInUse.toString(),
  });

  evidence.push({
    key: 'agents_with_open_tasks',
    label: 'Agents with open tasks',
    value: agentsWithOpenTasks.toString(),
  });

  evidence.push({
    key: 'agents_assigned',
    label: 'Agents assigned',
    value: agentsAssigned.toString(),
  });

  evidence.push({
    key: 'assignments_assigned',
    label: 'Assignments assigned',
    value: assignmentsAssigned === null ? 'N/A' : `${(assignmentsAssigned * 100).toFixed(1)}%`,
  });

  evidence.push({
    key: 'work_items_assigned',
    label: 'Work items assigned',
    value: workItemsAssigned === null ? 'N/A' : `${(workItemsAssigned * 100).toFixed(1)}%`,
  });

  const teamScore = clampScore(
    (assignmentsAssigned ?? 0) * 0.5 + (workItemsAssigned ?? 0) * 0.5
  );

  const band = determineBand(teamScore);

  return { score: teamScore, band, evidence, flags };
}

/** Evidence for risk dimension. */
export interface RiskData {
  /** Number of high-priority open items. */
  highPriorityOpenItems: number | null;
  /** Number of open blockers. */
  openBlockers: number | null;
  /** Number of external dependencies (incomplete). */
  externalDependencies: number | null;
  /** Number of known technical constraints (incomplete). */
  technicalConstraints: number | null;
  /** Number of high-priority open security tickets. */
  criticalSecurityIssues: number | null;
}

export function evaluateRisk(data: RiskData): DimensionScore {
  const flags: string[] = [];
  const evidence: EvidenceItem[] = [];

  const safe = (v: number | null, key: string): number => {
    if (v === null) {
      flags.push('missing_risk_' + key);
      evidence.push({ key: key + '_missing', label: key + ' not available', value: 'N/A' });
      return 100;
    }
    return v;
  };

  const highPriorityOpenItems = safe(data.highPriorityOpenItems, 'highPriorityOpenItems');
  const openBlockers = safe(data.openBlockers, 'openBlockers');
  const externalDependencies = safe(data.externalDependencies, 'externalDependencies');
  const technicalConstraints = safe(data.technicalConstraints, 'technicalConstraints');
  const criticalSecurityIssues = safe(data.criticalSecurityIssues, 'criticalSecurityIssues');

  // Evidence summary
  evidence.push({
    key: 'high_priority_open_items',
    label: 'High-priority open items',
    value: highPriorityOpenItems.toString(),
  });

  evidence.push({
    key: 'open_blockers',
    label: 'Open blockers',
    value: openBlockers.toString(),
  });

  evidence.push({
    key: 'external_dependencies',
    label: 'External dependencies',
    value: externalDependencies.toString(),
  });

  evidence.push({
    key: 'technical_constraints',
    label: 'Technical constraints',
    value: technicalConstraints.toString(),
  });

  evidence.push({
    key: 'critical_security_issues',
    label: 'Critical security issues',
    value: criticalSecurityIssues.toString(),
  });

  // Risk score (inverted: more items = lower score)
  let penalty = 0;
  penalty += highPriorityOpenItems * 3;
  penalty += openBlockers * 4;
  penalty += externalDependencies * 2;
  penalty += technicalConstraints * 2;
  penalty += criticalSecurityIssues * 5;
  const rawRiskScore = clampScore(Math.max(0, 100 - penalty)); // Not scaled to 0-100, adjust

  // Scale down if raw is > 200 to ensure it fits within range
  const scaledRiskScore = clampScore(Math.max(0, Math.min(100, rawRiskScore)));

  // Use a percentage to map to dimension scale: convert 0–100 to 0–100
  const band = determineBand(scaledRiskScore);

  return { score: scaledRiskScore, band, evidence, flags };
}

/** Compute band for a given score. */
export function determineBand(score: number): HealthBand {
  if (score >= 75) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

// Clamp helper to ensure values never go outside 0–100
const max = Math.max;
const min = Math.min;