import { describe, expect, it, vi } from 'vitest';
import type { ManagerOverview } from '@/lib/builderforceApi';
import { buildManagerCanvasModel, buildManagerWorkspacePanels, type ManagerCanvasProps } from './ManagerCanvas';

function props(): ManagerCanvasProps {
  const overview = {
    policy: { enabled: true, autoAssign: true, allowAutoMerge: false },
    stats: { total: 12, unscored: 2, unowned: 1, flagged: 3, openPullRequests: 4, blockedPullRequests: 1, lastRunAt: null },
    backlog: Array.from({ length: 12 }, (_, id) => ({ id })),
    actions: Array.from({ length: 7 }, (_, index) => ({ id: String(index), actionType: 'prioritize', summary: `Action ${index}`, detail: null, createdAt: '2026-08-02T12:00:00Z', taskId: null })),
    runTasks: [{ id: 1 }],
    directives: [{ id: 'one', status: 'active' }, { id: 'two', status: 'done' }],
    autonomy: { tokenBlocked: false },
    blockedPrs: [{ id: 'blocked' }],
  } as unknown as ManagerOverview;
  return {
    overview,
    managerName: 'Delivery agent',
    managerType: 'Delivery',
    lastManaged: 'Managed 2 minutes ago',
    running: false,
    canManage: true,
    onRun: vi.fn(),
    relative: () => 'now',
    actionLabel: () => 'Prioritized',
    labels: {
      canvas: 'AI Manager', live: 'Live', open: 'Open', run: 'Run now', running: 'Running',
      openCanvas: 'Open on canvas', openingCanvas: 'Opening…',
      policy: 'Policy', policyDescription: 'Rules', backlog: 'Backlog', backlogDescription: 'Ranked work',
      stuck: 'Stuck', stuckDescription: 'Blocked work', ask: 'Ask', askDescription: 'Accountability',
      today: 'Today', todayDescription: 'Outcomes', activity: 'Activity', activityDescription: 'Audit trail', total: 'Tickets', unscored: 'Unscored',
      unowned: 'Unowned', flagged: 'Gaps', runTasks: 'Runs', actions: 'Actions', directives: 'Directives',
      autoAssign: 'Auto assign', autoMerge: 'Auto merge', openPullRequests: 'Open PRs', blockedPullRequests: 'Blocked PRs',
      enabled: 'Enabled', paused: 'Paused', emptyActivity: 'No activity',
    },
  };
}

describe('buildManagerCanvasModel', () => {
  it('maps every manager capability into one connected operating canvas', () => {
    const model = buildManagerCanvasModel(props());
    expect(model.nodes.map((node) => node.id)).toEqual(['policy', 'backlog', 'stuck', 'manager', 'ask', 'today', 'activity']);
    expect(model.edges).toHaveLength(6);
    expect(model.edges.every((edge) => edge.source === 'manager' || edge.target === 'manager')).toBe(true);
    expect(buildManagerWorkspacePanels(model.nodes).map((panel) => panel.id)).toEqual([
      'manager-policy', 'manager-backlog', 'manager-stuck', 'manager-manager',
      'manager-ask', 'manager-today', 'manager-activity',
    ]);
  });

  it('visualizes live manager actions while keeping the full activity count', () => {
    const activity = buildManagerCanvasModel(props()).nodes.find((node) => node.id === 'activity');
    expect(activity?.data.badge).toBe('7');
    expect(activity?.data.items).toHaveLength(5);
    expect(activity?.data.footer).toBe('7 · Actions');
  });

  it('does not expose policy or run actions without manager permission', () => {
    const input = props();
    input.canManage = false;
    const model = buildManagerCanvasModel(input);
    expect(model.nodes.find((node) => node.id === 'policy')?.data.href).toBeUndefined();
    expect(model.nodes.find((node) => node.id === 'manager')?.data.onRun).toBeUndefined();
  });

  it('does not expose the run action when the effective manager kill-switch is off', () => {
    const input = props();
    input.overview.policy.enabled = false;
    const manager = buildManagerCanvasModel(input).nodes.find((node) => node.id === 'manager');

    expect(manager?.data.badge).toBe('Paused');
    expect(manager?.data.onRun).toBeUndefined();
  });
});
