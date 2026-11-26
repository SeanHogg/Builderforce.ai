import { mcpToolError, mcpToolResult } from '@seanhogg/builderforce-mcp/protocol';
import { protectToolOutput } from '@seanhogg/builderforce-mcp/policy';
import { describe, expect, it } from 'vitest';

describe('MCP output policy', () => {
  it('scrubs secret fields and masks JSON text in structured and plain results', () => {
    const secret = 'secret-with-no-known-prefix';
    const input = { password: secret, nested: { payload: JSON.stringify({ apiKey: secret, id: 7 }) } };
    const result = mcpToolResult('tasks.get', input);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.structuredContent).toMatchObject({ password: '[REDACTED]' });
    expect(result.structuredContent?.nested).toEqual({ payload: '{"apiKey":"[REDACTED]","id":7}' });
    expect(JSON.stringify(mcpToolError('tasks.get', JSON.stringify({ token: secret })))).not.toContain(secret);
  });

  it('caps both result representations after scrubbing', () => {
    const input = { description: 'x'.repeat(1_000_000), clientSecret: 'secret-with-no-known-prefix' };
    const result = mcpToolResult('tasks.list', input);
    expect(JSON.stringify(result).length).toBeLessThan(100_000);
    expect(JSON.stringify(result)).not.toContain(input.clientSecret);
    expect(JSON.stringify(protectToolOutput('tasks.list', input)).length).toBeLessThan(100_000);
  });
});
