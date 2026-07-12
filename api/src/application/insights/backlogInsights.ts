import { sql, or, eq, lte, gte, isNull } from 'drizzle-orm';
import {
  tasksCollector,
  initiativesCollector,
} from '../collectors/tasksCollector';

export interface BacklogAttentionItem {
  id: number;
  title: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  epicTitle: string | null;
  projectId: string | null;
  daysOverdue?: number;
  daysStale?: number;
  investigation?: 'overdue' | 'stale' | 'misaligned' | null;
  lastWorkedAt?: Date;
  link: string;
  score: number;
  epicKey: string | null;
}

export interface BacklogMetricsSummary {
  totalOverdue: number;
  overdueGrouped: Array<{ epicTitle: string | null; epicKey: string | null; count: number; daysOverdue: number }>;
  totalStaleWIP: number;
  staleWIPGrouped: Array<{ epicTitle: string | null; epicKey: string | null; count: number; daysStale: number }>;
  totalMisaligned: number;
  misalignedGrouped: Array<{ epicTitle: string | null; epicKey: string | null; count: number; epicPriority?: string[]; priorityValues?: number[] }>;
}

const DEFAULT_STALE_DAYS = 7;

/**
 * Pure-function summarizer for backlog attention metrics.
 * Accepts the results of collectors and returns a Top 10 Attention List and a summary.
 */
export function summarizeBacklogAttention(
  tasksSummary: Awaited<ReturnType<typeof tasksCollector>>,
  initiativesSummary: Awaited<ReturnType<typeof initiativesCollector>>,
) {
  const now = new Date();
  const staleThresholdMs = DEFAULT_STALE_DAYS * 24 * 60 * 60 * 1000;

  const overdueAttention: BacklogAttentionItem[] = [];
  const staleAttention: BacklogAttentionItem[] = [];
  const misalignedAttention: BacklogAttentionItem[] = [];

  const overdueGrouped: Map<string, { epicTitle: string | null; epicKey: string | null; count: number; maxDaysOverdue: number; epics: Map<string, { count: number; daysOverdue: number }> }> = new Map();

  const staleGrouped: Map<string, { epicTitle: string | null; epicKey: string | null; totalDaysStale: number; count: number; epics: Map<string, { count: number; daysStale: number }>; maxDaysStale: number }> = new Map();

  const misalignedGrouped: Map<string, { epicTitle: string | null; epicKey: string | null; totalScore: number; count: number }> = new Map();

  // ---------- Overdue logic ----------
  for (const t of tasksSummary.rankByPriority) {
    if (!t.dueDate || completedOrDone(t.status)) continue;
    const due = new Date(t.dueDate);
    if (due <= now) {
      const daysOverdue = Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86400_000));
      const epicTitle = t.initiativeKey ? initiativesSummary.byKey.get(t.initiativeKey)?.title : null;
      const score = daysOverdue + (priorityImpact(t.priority));
      overdueAttention.push({
        id: t.id,
        title: t.title,
        priority: t.priority,
        epicTitle,
        projectId: t.projectKey,
        daysOverdue,
        investigation: 'overdue',
        lastWorkedAt: t.lastWorkedAt || t.updatedAt,
        link: `/projects/${t.projectKey}/tasks/${t.id}`,
        score,
        epicKey: t.initiativeKey ?? null,
      });

      const key = (t.initiativeKey ?? 'Uncategorized');
      const group = overdueGrouped.get(key) ?? { epicTitle, epicKey: t.initiativeKey, count: 0, maxDaysOverdue: 0, epics: new Map() };
      overdueGrouped.set(key, {
        ...group,
        epicTitle,
        epicKey: t.initiativeKey,
        count: group.count + 1,
        maxDaysOverdue: Math.max(group.maxDaysOverdue, daysOverdue),
      });
      const epicDetail = group.epics.get(t.initiativeKey ?? 'Uncategorized') ?? { count: 0, daysOverdue: 0 };
      group.epics.set(t.initiativeKey ?? 'Uncategorized', { count: epicDetail.count + 1, daysOverdue: Math.max(epicDetail.daysOverdue, daysOverdue) });
    }
  }

  // ---------- Stale WIP logic ----------
  for (const t of tasksSummary.rankByPriority) {
    if (t.status !== 'in_progress') continue;
    if (!t.lastWorkedAt && !t.updatedAt) continue;
    const lastWorked = t.lastWorkedAt ?? t.updatedAt;
    const staleMomentMs = lastWorked.getTime() + staleThresholdMs;
    if (now.getTime() < staleMomentMs) continue;

    const daysStale = Math.max(0, Math.floor((now.getTime() - staleMomentMs) / 86400_000));
    const epicTitle = t.initiativeKey ? initiativesSummary.byKey.get(t.initiativeKey)?.title : null;
    const score = daysStale + (priorityImpact(t.priority));
    staleAttention.push({
      id: t.id,
      title: t.title,
      priority: t.priority,
      epicTitle,
      projectId: t.projectKey,
      daysStale,
      investigation: 'stale',
      lastWorkedAt: lastWorked,
      link: `/projects/${t.projectKey}/tasks/${t.id}`,
      score,
      epicKey: t.initiativeKey ?? null,
    });

    const key = (t.initiativeKey ?? 'Uncategorized');
    const group = staleGrouped.get(key) ?? { epicTitle, epicKey: t.initiativeKey, totalDaysStale: 0, count: 0, epics: new Map(), maxDaysStale: 0 };
    staleGrouped.set(key, {
      ...group,
      epicTitle,
      epicKey: t.initiativeKey,
      totalDaysStale: group.totalDaysStale + daysStale,
      count: group.count + 1,
      maxDaysStale: Math.max(group.maxDaysStale, daysStale),
    });
  }

  // ---------- Priority misalignment ----------
  for (const t of tasksSummary.rankByExposureUnassigned) {
    if (!isUnassignedOwner(t.assignedUserId, t.assignedAgentRef)) continue;

    const epicTitle = t.initiativeKey ? initiativesSummary.byKey.get(t.initiativeKey)?.title : null;
    const score = priorityMisalignmentScore(t.priority);
    misalignedAttention.push({
      id: t.id,
      title: t.title,
      priority: t.priority,
      epicTitle,
      projectId: t.projectKey,
      link: `/projects/${t.projectKey}/tasks/${t.id}`,
      score,
      investigation: 'misaligned',
      epicKey: t.initiativeKey ?? null,
    });

    const key = (t.initiativeKey ?? 'Uncategorized');
    const group = misalignedGrouped.get(key) ?? { epicTitle, epicKey: t.initiativeKey, totalScore: 0, count: 0 };
    misalignedGrouped.set(key, {
      ...group,
      epicTitle,
      epicKey: t.initiativeKey,
      totalScore: group.totalScore + score,
      count: group.count + 1,
    });
  }

  // ---------- Rank and return ----------
  const attentionItems = [
    ...overdueAttention.map(a => ({ ...a, investigation: 'overdue' })),
    ...staleAttention.map(a => ({ ...a, investigation: 'stale' })),
    ...misalignedAttention.map(a => ({ ...a, investigation: 'misaligned' })),
  ].sort((a, b) => b.score - a.score).slice(0, 10);

  const overdueGroupedArray = Array.from(overdueGrouped.entries()).map(([key, g]) => ({
    epicTitle: g.epicTitle,
    epicKey: g.epicKey,
    count: g.count,
    daysOverdue: g.maxDaysOverdue,
  }));

  const staleGroupedArray = Array.from(staleGrouped.entries()).map(([key, g]) => ({
    epicTitle: g.epicTitle,
    epicKey: g.epicKey,
    count: g.count,
    daysStale: g.maxDaysStale,
  }));

  const misalignedGroupedArray = Array.from(misalignedGrouped.entries()).map(([key, g]) => ({
    epicTitle: g.epicTitle,
    epicKey: g.epicKey,
    count: g.count,
  }));

  return {
    attentionItems,
    summary: {
      totalOverdue: overdueAttention.length,
      overdueGrouped,
      totalStaleWIP: staleAttention.length,
      staleWIPGrouped,
      totalMisaligned: misalignedAttention.length,
      misalignedGrouped,
    },
  };
}

function completedOrDone(status: string | null): boolean {
  return status === 'completed';
}

function isUnassignedOwner(assignedUserId: string | null, assignedAgentRef: string | null): boolean {
  return !assignedUserId && !assignedAgentRef;
}

function priorityImpact(priority: string, baseValue: number = 0): number {
  switch (priority) {
    case 'urgent': return 1000 + baseValue;
    case 'high': return 500 + baseValue;
    case 'medium': return baseValue;
    case 'low': return baseValue;
    default: return baseValue;
  }
}

function priorityMisalignmentScore(p: string): number {
  switch (p) {
    case 'urgent': return 1000;
    case 'high': return 500;
    case 'medium': return 100;
    case 'low': return 10;
    default: return 0;
  }
}