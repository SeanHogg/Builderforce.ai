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

  it('keeps the dataset query tool so guest analytics use real rows, not placeholders', () => {
    const body = {
      messages: [{ role: 'user', content: 'chart the delivery success rate' }],
      tools: [tool('canvas_query_dataset'), tool('builtin_projects_create')],
      tool_choice: 'auto',
    } as ChatCompletionRequest;

    restrictGuestTools(body);

    expect(body.tools).toEqual([tool('canvas_query_dataset')]);
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

  it('keeps the research tools — without them a guest turn invents its facts', () => {
    // These three are the ONLY server-executing tools a guest may hold, and they run
    // through /api/guest/research/* (guest token + its own daily cap + SSRF guard).
    // The names must match the MCP-advertised ones, because one canvas system prompt
    // names them for both the authed and the logged-out surface.
    const body = {
      messages: [{ role: 'user', content: 'research the top 10 EV makers and chart it' }],
      tools: [
        tool('builtin_web_search'), tool('builtin_web_fetch'), tool('builtin_geo_geocode'),
        tool('builtin_tasks_create'),
      ],
      tool_choice: 'auto',
    } as ChatCompletionRequest;

    restrictGuestTools(body);

    expect(body.tools).toEqual([
      tool('builtin_web_search'), tool('builtin_web_fetch'), tool('builtin_geo_geocode'),
    ]);
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
