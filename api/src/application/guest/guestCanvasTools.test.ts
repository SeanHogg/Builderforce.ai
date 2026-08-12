import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_REQUIRED_CANVAS_TOOLS,
  CREATION_CANVAS_TOOLS,
  GUEST_SAFE_CANVAS_TOOLS,
} from '@builderforce/creation-canvas-contract';
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

  /**
   * The drift this contract exists to stop. The browser advertised 24 canvas tools and
   * this filter allowed 12, so the model was handed a tool list the gateway then edited
   * — `canvas_read_object` (which the canvas system prompt explicitly instructs it to
   * call) and the whole diagnostics vocabulary vanished between advertisement and
   * dispatch, and nothing errored.
   */
  it('admits every guest-safe canvas tool the browser advertises', () => {
    const body = {
      messages: [{ role: 'user', content: 'is that file on my board?' }],
      tools: GUEST_SAFE_CANVAS_TOOLS.map((name) => tool(name)),
      tool_choice: 'auto',
    } as ChatCompletionRequest;

    restrictGuestTools(body);

    expect((body.tools as Array<{ function: { name: string } }>).map((t) => t.function.name))
      .toEqual([...GUEST_SAFE_CANVAS_TOOLS]);
  });

  it('refuses every tenant-backed canvas tool, whatever the client claims', () => {
    const body = {
      messages: [{ role: 'user', content: 'connect my email' }],
      tools: [...ACCOUNT_REQUIRED_CANVAS_TOOLS.map((name) => tool(name)), tool('canvas_add_object')],
      tool_choice: 'auto',
    } as ChatCompletionRequest;

    restrictGuestTools(body);

    expect(body.tools).toEqual([tool('canvas_add_object')]);
  });

  it('classifies every canvas tool exactly once', () => {
    expect(new Set(CREATION_CANVAS_TOOLS).size).toBe(CREATION_CANVAS_TOOLS.length);
    expect(CREATION_CANVAS_TOOLS.length).toBe(GUEST_SAFE_CANVAS_TOOLS.length + ACCOUNT_REQUIRED_CANVAS_TOOLS.length);
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
