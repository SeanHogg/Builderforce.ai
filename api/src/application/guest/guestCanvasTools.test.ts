import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest } from '../llm/LlmProxyService';
import { restrictGuestTools } from './guestCanvasTools';

const tool = (name: string) => ({
  type: 'function',
  function: { name, description: `${name} description`, parameters: { type: 'object' } },
});

describe('restrictGuestTools', () => {
  it('preserves local canvas tools so a guest Brain can actually change the canvas', () => {
    const body = {
      messages: [{ role: 'user', content: 'build a new LLM' }],
      tools: [tool('canvas_read_snapshot'), tool('canvas_add_object')],
      tool_choice: 'required',
    } as ChatCompletionRequest;

    restrictGuestTools(body);

    expect(body.tools).toEqual([tool('canvas_read_snapshot'), tool('canvas_add_object')]);
    expect(body.tool_choice).toBe('auto');
  });

  it('removes tenant, MCP, and unknown tools from a mixed guest request', () => {
    const body = {
      messages: [{ role: 'user', content: 'create and publish it' }],
      tools: [tool('canvas_add_object'), tool('builtin_projects_create'), tool('mcp_publish_model')],
      tool_choice: { type: 'function', function: { name: 'builtin_projects_create' } },
    } as ChatCompletionRequest;

    restrictGuestTools(body);

    expect(body.tools).toEqual([tool('canvas_add_object')]);
    expect(body.tool_choice).toBe('auto');
  });

  it('keeps ordinary guest chat tool-free', () => {
    const body = {
      messages: [{ role: 'user', content: 'hello' }],
      tools: [tool('write_file')],
      tool_choice: 'auto',
    } as ChatCompletionRequest;

    restrictGuestTools(body);

    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
  });
});
