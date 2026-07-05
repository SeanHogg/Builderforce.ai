import { describe, it, expect } from 'vitest';
import { SecurityTicketAccessService, type SecurityAccessConfig, type TicketViewer } from './SecurityTicketAccessService';
import { TenantRole, TaskType } from '../../domain/shared/types';

const denyAll: SecurityAccessConfig = {
  audiences: { humans: false, hired: false, talent: false },
  allowUserIds: [],
  allowAgentRefs: [],
};

const { canView, filterTasks } = SecurityTicketAccessService;

describe('SecurityTicketAccessService.canView (the default-deny visibility gate)', () => {
  it('hides security tickets from an ordinary developer by default', () => {
    const viewer: TicketViewer = { userId: 'u1', role: TenantRole.DEVELOPER, accountType: 'standard' };
    expect(canView(viewer, denyAll)).toBe(false);
  });

  it('always shows them to a manager/owner (they administer access)', () => {
    expect(canView({ userId: 'm', role: TenantRole.MANAGER }, denyAll)).toBe(true);
    expect(canView({ userId: 'o', role: TenantRole.OWNER }, denyAll)).toBe(true);
  });

  it('always shows them to the Security agent itself', () => {
    expect(canView({ isAgent: true, agentRef: 'security-t1', builtinKind: 'security' }, denyAll)).toBe(true);
  });

  it('honors the humans audience toggle for a member', () => {
    const viewer: TicketViewer = { userId: 'u1', role: TenantRole.DEVELOPER, accountType: 'standard' };
    expect(canView(viewer, { ...denyAll, audiences: { humans: true, hired: false, talent: false } })).toBe(true);
  });

  it('routes a freelancer to the talent audience, not humans', () => {
    const talent: TicketViewer = { userId: 'f1', role: TenantRole.DEVELOPER, accountType: 'freelancer' };
    expect(canView(talent, { ...denyAll, audiences: { humans: true, hired: false, talent: false } })).toBe(false);
    expect(canView(talent, { ...denyAll, audiences: { humans: false, hired: false, talent: true } })).toBe(true);
  });

  it('routes an agent to the hired audience', () => {
    const agent: TicketViewer = { isAgent: true, agentRef: 'agent-x' };
    expect(canView(agent, { ...denyAll, audiences: { humans: true, hired: false, talent: false } })).toBe(false);
    expect(canView(agent, { ...denyAll, audiences: { humans: false, hired: true, talent: false } })).toBe(true);
  });

  it('honors the explicit user + agent allowlists', () => {
    const user: TicketViewer = { userId: 'vip', role: TenantRole.DEVELOPER, accountType: 'standard' };
    expect(canView(user, { ...denyAll, allowUserIds: ['vip'] })).toBe(true);
    const agent: TicketViewer = { isAgent: true, agentRef: 'trusted-agent' };
    expect(canView(agent, { ...denyAll, allowAgentRefs: ['trusted-agent'] })).toBe(true);
  });
});

describe('SecurityTicketAccessService.filterTasks', () => {
  const rows = [
    { id: 1, taskType: TaskType.TASK },
    { id: 2, taskType: TaskType.SECURITY },
    { id: 3, taskType: TaskType.GAP },
  ];

  it('drops security tickets for a viewer who may not see them', () => {
    const viewer: TicketViewer = { userId: 'u1', role: TenantRole.DEVELOPER, accountType: 'standard' };
    const out = filterTasks(rows, viewer, denyAll);
    expect(out.map((r) => r.id)).toEqual([1, 3]);
  });

  it('keeps the full list for a manager', () => {
    const out = filterTasks(rows, { role: TenantRole.MANAGER }, denyAll);
    expect(out.map((r) => r.id)).toEqual([1, 2, 3]);
  });
});
