import { describe, expect, it } from 'vitest';
import { assertMayRunBuiltinTool, mayRunBuiltinTool } from './builtinToolAuthority';
import { TenantRole } from '../../domain/shared/types';

describe('mayRunBuiltinTool — the tool-path twin of the route gates', () => {
  it('refuses a contributor every workspace write: tasks, projects, agents, runs', () => {
    for (const tool of ['tasks.create', 'tasks.update', 'projects.create', 'project_agents.create', 'cloud_agents.create', 'chats.dispatch_agent', 'attachments.write']) {
      expect(mayRunBuiltinTool(tool, true, TenantRole.CONTRIBUTOR)).toBe(false);
      expect(mayRunBuiltinTool(tool, true, TenantRole.VIEWER)).toBe(false);
      expect(() => assertMayRunBuiltinTool(tool, true, TenantRole.CONTRIBUTOR)).toThrow(/'developer' role/);
    }
  });

  it('admits developer and above to workspace writes', () => {
    for (const role of [TenantRole.DEVELOPER, TenantRole.MANAGER, TenantRole.OWNER]) {
      expect(mayRunBuiltinTool('tasks.create', true, role)).toBe(true);
    }
  });

  it('lets any member write only their OWN chat and session rows', () => {
    for (const tool of ['brain.create', 'brain.update', 'brain.delete', 'chats.link_ticket', 'chats.consolidate', 'my_sessions.revoke']) {
      expect(mayRunBuiltinTool(tool, true, TenantRole.CONTRIBUTOR)).toBe(true);
    }
  });

  it('never gates a read, and leaves a role-less (agent/server) caller to its run', () => {
    expect(mayRunBuiltinTool('tasks.list', false, TenantRole.VIEWER)).toBe(true);
    expect(mayRunBuiltinTool('tasks.create', true, undefined)).toBe(true);
  });

  it('refuses an unknown role rather than defaulting it in', () => {
    expect(mayRunBuiltinTool('tasks.create', true, 'member')).toBe(false);
  });
});
