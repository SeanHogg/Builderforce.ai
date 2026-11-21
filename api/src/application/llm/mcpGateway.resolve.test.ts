import { describe, expect, it } from 'vitest';
import { resolveGatewayMcpTool } from './mcpGateway';
import type { McpToolEntry } from './mcpExtensionService';

/** The JSON-RPC `tools/call` lookup reads a model-emitted flat name back to its entry: a catalog
 *  id (`tasks.archive_many`) reaches the advertised `builtin_tasks_archive_many` instead of 404ing. */
describe('resolveGatewayMcpTool — catalog ids resolve to the advertised entry', () => {
  const tools = [
    { name: 'builtin_tasks_archive_many', extensionId: 'builtin', tool: 'tasks.archive_many' },
    { name: 'mcp__github__list_issues', extensionId: 'ext-1', tool: 'list_issues' },
  ] as unknown as McpToolEntry[];

  it('resolves the exact advertised name', () => {
    expect(resolveGatewayMcpTool(tools, 'builtin_tasks_archive_many')?.tool).toBe('tasks.archive_many');
  });

  it('resolves a dotted catalog id and the unprefixed underscore form', () => {
    expect(resolveGatewayMcpTool(tools, 'tasks.archive_many')?.name).toBe('builtin_tasks_archive_many');
    expect(resolveGatewayMcpTool(tools, 'tasks_archive_many')?.name).toBe('builtin_tasks_archive_many');
  });

  it('keeps an mcp__ name exact and an unknown name unresolved', () => {
    expect(resolveGatewayMcpTool(tools, 'mcp__github__list_issues')?.tool).toBe('list_issues');
    expect(resolveGatewayMcpTool(tools, 'tasks.delete_everything')).toBeNull();
  });
});
