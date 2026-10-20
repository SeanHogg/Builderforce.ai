import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONNECTED_ONLY_DOMAIN_TOOL_NAMES,
  LOCAL_DOMAIN_TOOL_NAMES,
  classifyDomainTool,
  looksLikeServerMcpTool,
  mayEnqueueOffline,
  type LocalDomainToolName,
} from './domainToolClass.js';

const LOCAL: readonly LocalDomainToolName[] = [
  'project-create',
  'project-update',
  'project-move',
  'project-archive',
  'ticket-create',
  'ticket-update',
  'ticket-move',
  'ticket-archive',
  'memory-recall',
  'local-memory-recall',
  'audit-finding',
  'local-audit-finding',
];

const CONNECTED = ['cloud-execution', 'meeting-join', 'remote-session-read'] as const;

describe('domain tool class', () => {
  it('lists the local adapters and the named connected-only tools', () => {
    expect([...LOCAL_DOMAIN_TOOL_NAMES]).toEqual([...LOCAL]);
    expect([...CONNECTED_ONLY_DOMAIN_TOOL_NAMES]).toEqual([...CONNECTED]);
    expect(Object.isFrozen(LOCAL_DOMAIN_TOOL_NAMES)).toBe(true);
    expect(Object.isFrozen(CONNECTED_ONLY_DOMAIN_TOOL_NAMES)).toBe(true);
  });

  it('classifies supported domain tools as local and enqueueable', () => {
    for (const name of LOCAL) {
      const classified = classifyDomainTool(name);
      expect(classified).toEqual({ mode: 'local' });
      expect(Object.isFrozen(classified)).toBe(true);
      expect(mayEnqueueOffline(name)).toBe(true);
      expect(looksLikeServerMcpTool(name)).toBe(false);
    }
  });

  it('accepts the same local tool under case, space, and underscore spellings', () => {
    expect(classifyDomainTool('Project_Create')).toEqual({ mode: 'local' });
    expect(classifyDomainTool('  ticket archive  ')).toEqual({ mode: 'local' });
    expect(classifyDomainTool('MEMORY-RECALL')).toEqual({ mode: 'local' });
    expect(classifyDomainTool('local memory recall')).toEqual({ mode: 'local' });
    expect(classifyDomainTool('Local_Audit_Finding')).toEqual({ mode: 'local' });
    expect(mayEnqueueOffline('Ticket_Move')).toBe(true);
  });

  it('refuses cloud execution, meeting join, and remote session read', () => {
    for (const name of CONNECTED) {
      const classified = classifyDomainTool(name);
      expect(classified).toEqual({ mode: 'connected-only' });
      expect(Object.isFrozen(classified)).toBe(true);
      expect(mayEnqueueOffline(name)).toBe(false);
    }
    expect(classifyDomainTool('cloud execution')).toEqual({ mode: 'connected-only' });
    expect(classifyDomainTool('Meeting_Join')).toEqual({ mode: 'connected-only' });
    expect(classifyDomainTool('  remote session read  ')).toEqual({ mode: 'connected-only' });
    expect(mayEnqueueOffline('cloud_execution')).toBe(false);
  });

  it('treats a server MCP tool as connected-only and does not enqueue it', () => {
    const mcpNames = [
      'mcp',
      'MCP',
      'cloud-mcp-tool',
      'mcp-management',
      'external-mcp',
      'mcp__server__tool',
      'some_mcp_tool',
      'MyMcpTool',
      'builtin_tasks_create',
      'builtin-tasks-list',
      '  Builtin_Tasks_Create  ',
    ];
    for (const name of mcpNames) {
      expect(looksLikeServerMcpTool(name)).toBe(true);
      expect(classifyDomainTool(name)).toEqual({ mode: 'connected-only' });
      expect(mayEnqueueOffline(name)).toBe(false);
    }
  });

  it('does not let an mcp-shaped name through as a local adapter', () => {
    expect(classifyDomainTool('project-create-mcp')).toEqual({ mode: 'connected-only' });
    expect(mayEnqueueOffline('ticket-archive-mcp')).toBe(false);
    expect(mayEnqueueOffline('builtin-memory-recall')).toBe(false);
  });

  it('leaves an unknown name unknown and does not enqueue it', () => {
    for (const name of ['', '   ', 'not-a-domain-tool', 'oauth-management', 'list-files', 'git-push', 'project']) {
      expect(classifyDomainTool(name)).toEqual({ mode: 'unknown' });
      expect(mayEnqueueOffline(name)).toBe(false);
    }
    expect(classifyDomainTool(undefined as unknown as string)).toEqual({ mode: 'unknown' });
    expect(mayEnqueueOffline(undefined as unknown as string)).toBe(false);
  });

  it('enqueues only the local mode', () => {
    expect(mayEnqueueOffline('project-update')).toBe(true);
    expect(mayEnqueueOffline('meeting-join')).toBe(false);
    expect(mayEnqueueOffline('builtin_tasks_create')).toBe(false);
    expect(mayEnqueueOffline('unknown-tool')).toBe(false);
  });

  it('imports nothing and does not enqueue', () => {
    const source = readFileSync(new URL('./domainToolClass.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import\s/m);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\benqueue\b/);
    expect(source).not.toMatch(/from\s+['"]node:(https?|http|net)['"]/);
  });
});
