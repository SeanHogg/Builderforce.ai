/**
 * Project 360 model — the shape returned by `GET /api/projects/:id/360` and
 * consumed by <Project360View>. Kept in the shared UI package so every surface
 * (the VS Code webview today, the web app next) renders the SAME contract.
 * Mirrors the API's `computeProject360` output.
 */

export type HealthTier = 'healthy' | 'watch' | 'at_risk' | 'critical';

export interface Project360Action {
  kind: 'board' | 'approvals' | 'brain' | 'run-task' | 'open-task';
  label: string;
  text?: string;
  /** `taskType` lets the host open a chat tied to the RIGHT ticket kind — an epic
   *  or gap links to its own kind rather than a generic task. */
  task?: { id: number; key?: string; title: string; taskType?: 'task' | 'epic' | 'gap' };
}

export interface Project360Gap {
  id: string;
  dimension: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail?: string;
  action?: Project360Action;
}

export interface Project360Dimension {
  key: string;
  label: string;
  pillar: string;
  score: number;
  tier: HealthTier;
  color: string;
  summary: string;
  gaps: Project360Gap[];
}

export interface Project360Pillar {
  key: string;
  label: string;
  score: number;
  tier: HealthTier;
  color: string;
}

export interface Project360Member {
  ref: string;
  kind: 'human' | 'host' | 'cloud';
  name: string;
  status: 'working' | 'awaiting' | 'blocked' | 'idle' | 'available';
  reason: string;
  taskId?: number;
  taskKey?: string;
  taskTitle?: string;
  /** Work-item type of the assigned task — threaded into open/run actions so a
   *  chat opened from a person card links to the correct ticket kind. */
  taskType?: 'task' | 'epic' | 'gap';
}

export interface Project360 {
  project: { id: number; name: string; key?: string; status?: string };
  hasData: boolean;
  overall: { score: number; tier: HealthTier; color: string; progressPct: number };
  counts: {
    total: number;
    completed: number;
    open: number;
    blocked: number;
    overdue: number;
    unassigned: number;
    inProgress: number;
    activeRuns: number;
    workers: number;
  };
  pillars: Project360Pillar[];
  dimensions: Project360Dimension[];
  gaps: Project360Gap[];
  workforce: Project360Member[];
  generatedAt: string;
}

/** UI strings — defaulted to English, overridable so the host can localize
 *  (the VS Code webview feeds its `vscode.l10n` bundle; the web app next-intl). */
export interface Project360Labels {
  title: string;
  subtitle: string;
  overall: string;
  progress: string;
  refresh: string;
  openBoard: string;
  improveAll: string;
  connecting: string;
  loadError: string;
  noData: string;
  noDataHint: string;
  missingItems: string;
  noGaps: string;
  workforce: string;
  noWorkforce: string;
  allDimensions: string;
  counts_open: string;
  counts_blocked: string;
  counts_overdue: string;
  counts_running: string;
  status_working: string;
  status_awaiting: string;
  status_blocked: string;
  status_idle: string;
  status_available: string;
  member_run: string;
  member_open: string;
  improveSeedIntro: string;
}

export const DEFAULT_PROJECT360_LABELS: Project360Labels = {
  title: 'Project 360',
  subtitle: 'The whole picture — health, gaps, and who is moving the work.',
  overall: 'Overall health',
  progress: 'Progress',
  refresh: 'Refresh',
  openBoard: 'Open board',
  improveAll: 'Improve with Brain',
  connecting: 'Loading Project 360…',
  loadError: "Couldn't load Project 360",
  noData: 'No tasks yet',
  noDataHint: 'Add tasks to this project to see its health, gaps, and team activity.',
  missingItems: 'Missing items — improve health',
  noGaps: 'No gaps found. This project is in good shape.',
  workforce: "Who's working / idle",
  noWorkforce: 'Nobody is assigned to this project yet.',
  allDimensions: 'All dimensions',
  counts_open: 'open',
  counts_blocked: 'blocked',
  counts_overdue: 'overdue',
  counts_running: 'running',
  status_working: 'Working',
  status_awaiting: 'Awaiting input',
  status_blocked: 'Blocked',
  status_idle: 'Idle',
  status_available: 'Available',
  member_run: 'Run',
  member_open: 'Open',
  improveSeedIntro: 'Here is my project’s Project 360 health check. Help me work through these gaps, highest impact first.',
};
