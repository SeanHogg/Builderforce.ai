import { advertiseName, resolveName } from '@seanhogg/builderforce-mcp';
import { describe, expect, it } from 'vitest';
import { listPublicMcpTools, resolveGatewayMcpTool } from './mcpGateway';

describe('canonical MCP names', () => {
  it('keeps Platform domain and action separators reversible', () => {
    expect(advertiseName('platform', 'tasks.archive_many')).toBe('platform__tasks_archive_many');
    expect(advertiseName('platform', 'work_items.list')).toBe('platform__work-items_list');
    for (const tool of ['work_items.list', 'work-items.list', 'encoded_ops.list', 'encoded-ops.list']) {
      const name = advertiseName('platform', tool);
      expect(resolveName(name)).toEqual({ source: 'platform', tool });
    }
    expect(advertiseName('platform', 'work_items.list')).not.toBe(advertiseName('platform', 'work-items.list'));
    expect(() => advertiseName('external', '\uD800')).toThrow('Invalid Unicode');
  });

  it('advertises unique, bounded names and dispatches saved names to the same row', async () => {
    const tools = await listPublicMcpTools('full', 'canonical');
    expect(tools.every((tool) => tool.name.length <= 64)).toBe(true);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    const entry = tools.find((tool) => tool.tool === 'tasks.list');
    expect(entry?.name).toBe('platform__tasks_list');
    for (const name of ['platform__tasks_list', 'builtin_tasks_list', 'tasks.list', 'tasks_list']) {
      expect(resolveGatewayMcpTool(tools, name)).toBe(entry);
    }
  });

  it('rejects ambiguous legacy aliases while leaving each canonical entry callable', () => {
    const tools = [
      { extensionId: 'x', tool: 'one.a', name: 'ext-x__encoded-6f6e652e61', legacyName: 'mcp_x_one_a' },
      { extensionId: 'x', tool: 'one_a', name: 'ext-x__one_a', legacyName: 'mcp_x_one_a' },
    ].map((tool) => ({ ...tool, description: '', parameters: {} }));
    expect(resolveGatewayMcpTool(tools, 'mcp_x_one_a')).toBeNull();
    expect(resolveGatewayMcpTool(tools, 'ext-x__one_a')).toBe(tools[1]);
  });
});
