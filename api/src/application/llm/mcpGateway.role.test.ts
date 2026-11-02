import { describe, expect, it } from 'vitest';
import { roleFilterBuiltinTools } from './mcpGateway';
import { TenantRole } from '../../domain/shared/types';

/** The advertisement half of the tool-path role gate: a sub-developer caller is never
 *  SHOWN a mutating tool its run could only 403 on (the failure that sent VS Code
 *  chats into tasks.create/projects.create retry loops). The dispatch-time gate in
 *  `builtinToolAuthority` stays the enforcement. */
describe('roleFilterBuiltinTools — the advertised catalog honours the caller role', () => {
  const tools = [
    { tool: 'tasks.list', mutates: false },
    { tool: 'tasks.create', mutates: true },
    { tool: 'projects.create', mutates: true },
    { tool: 'tickets.from_delta', mutates: true },
    { tool: 'brain.create', mutates: true },
  ];

  it('hides every workspace write from a contributor and a viewer, keeping their own-chat writes', () => {
    for (const role of [TenantRole.CONTRIBUTOR, TenantRole.VIEWER]) {
      const ids = roleFilterBuiltinTools(role, tools).map((t) => t.tool);
      expect(ids).toEqual(['tasks.list', 'brain.create']);
    }
  });

  it('shows developer and above the whole catalog', () => {
    for (const role of [TenantRole.DEVELOPER, TenantRole.MANAGER, TenantRole.OWNER]) {
      expect(roleFilterBuiltinTools(role, tools)).toHaveLength(tools.length);
    }
  });

  it('leaves a role-less (machine/agent) caller the whole catalog', () => {
    expect(roleFilterBuiltinTools(null, tools)).toHaveLength(tools.length);
    expect(roleFilterBuiltinTools(undefined, tools)).toHaveLength(tools.length);
  });
});
