/**
 * PRD 35 WS4 parity rulings, Area T, round two: what the agent puts ON THE WIRE and what it says on the way, held to the loop -
 * the window fit's memo, the model preflight, the closing answer's failure count, the coder re-ask, a vision turn, a call with
 * no arguments and a narration that cannot be saved. Each runs through the real `startRun` on both engines.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_FAILURE_STREAK } from '@builderforce/agent-loop';
import { gatewayModelWindows } from '../gatewayModels';
import { StreamInterruptedError, type ContentPart, type StreamChatResult } from '../streamChatCompletion';
import { windowFitTranscript } from '../test/windowFitTranscript';
import { answer, bothEngines, callTool, script, stepsLabelled, toolSpec, type Observed, type StreamOpts } from '../test/engineKit';
import { brainModelTransport } from './modelTransport';
import { toRunMessage, withImages } from './runMessages';

const TOOLS = [toolSpec('read_file'), toolSpec('edit_file')];
const host = async () => ({ ok: true, content: 'export const a = 1;' });
const base = { tools: TOOLS, runTool: host, userTurn: 'look at a.ts' };
const read = (i = 0) => callTool('read_file', { path: `src/f${i}.ts` }, '', `r${i}`);
const toolless = (o: Observed): StreamOpts[] => o.asked.filter((r) => r.tools === undefined);

describe('the window fit packs a small-window model once, not every turn', () => {
  it('reuses its last pack while the history it was made from is unchanged', async () => {
    const small = 'direct/cloudflare/@cf/meta/llama-3.3-70b';
    const { loop, agent } = await bothEngines(9400, () => ({
      ...base,
      model: small,
      modelStrict: true,
      maxTokens: 512,
      windowSources: { cloud: gatewayModelWindows({ byo: { models: [{ id: small, contextWindow: 4_096 }] } }) },
      seed: windowFitTranscript().slice(1, -1),
      userTurn: 'Now wire the chip row.',
      stream: script([read(0), read(1), read(2), answer('Wired.', { resolvedModel: small })]),
    }));
    expect(stepsLabelled(loop.trace, 'llm.handoff').length).toBeGreaterThan(0);
    expect(stepsLabelled(agent.trace, 'llm.handoff')).toHaveLength(stepsLabelled(loop.trace, 'llm.handoff').length);
    expect(toolless(agent)).toHaveLength(toolless(loop).length);
  });

  it('hands the stream the SAME wire row for the same transcript row', async () => {
    const seen: unknown[][] = [];
    const model = brainModelTransport({ stream: async (opts) => { seen.push(opts.messages); return { text: 'ok', toolCalls: [], finishReason: 'stop' }; } });
    const rows = [
      { role: 'system' as const, content: 's' },
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{}' }] },
      { role: 'tool' as const, content: '{}', toolCallId: 'c1' },
    ];
    await model.complete({ messages: rows });
    await model.complete({ messages: rows });
    seen[0]!.forEach((row, i) => expect(seen[1]![i]).toBe(row));
  });
});

describe('T10 (closed) the model preflight says what the loop says, no more', () => {
  const FLASH = '~google/gemini-flash-latest';
  const count = (o: Observed) => stepsLabelled(o.trace, 'model.preflight').length;

  it('a strict pin on a Flash-class model is warned once', async () => {
    const { loop, agent } = await bothEngines(9410, () => ({ ...base, model: FLASH, modelStrict: true, modelPreflight: async () => ({ byoUnresolved: [] }), stream: script([answer('Done.')]) }));
    expect(count(loop)).toBe(1);
    expect(count(agent)).toBe(count(loop));
  });

  it('a QUICK run on a Flash-class quick model is not warned (the loop never warned about it)', async () => {
    const { loop, agent } = await bothEngines(9412, () => ({
      ...base,
      userTurn: 'Fix the typo in the README heading',
      pipeline: { routing: 'auto', quickModel: FLASH },
      modelPreflight: async () => ({ byoUnresolved: [] }),
      stream: script([answer('Done.')]),
    }));
    expect(count(agent)).toBe(count(loop));
  });
});

describe('the closing answer names the real count of failed calls', () => {
  it('says how many calls in a row failed when one turn overshoots the breaker', async () => {
    const calls = DEFAULT_TOOL_FAILURE_STREAK + 4;
    const burst = (): StreamChatResult => ({
      text: '', finishReason: 'tool_calls', resolvedModel: 'm',
      toolCalls: Array.from({ length: calls }, (_, i) => ({ id: `f${i}`, name: 'edit_file', args: JSON.stringify({ path: `f${i}.ts`, old: 'a', new: 'b' }) })),
    });
    const { loop, agent } = await bothEngines(9420, () => ({
      ...base,
      runTool: async () => { throw new Error('disk full'); },
      stream: async (opts) => (opts.tools === undefined ? answer('Closing.')() : burst()),
    }));
    const closing = (o: Observed) => String(toolless(o).at(-1)!.messages.at(-1)!.content);
    expect(closing(loop)).toContain(`last ${calls} tool calls`);
    expect(closing(agent)).toBe(closing(loop));
  });
});

describe('the coder re-ask is one more request of the SAME turn', () => {
  it('is not retried when it fails', async () => {
    const stream = async (opts: StreamOpts): Promise<StreamChatResult> => {
      if (opts.role === 'plan') return callTool('edit_file', { path: 'a.ts', old: 'x', new: 'y' }, 'planner words')();
      throw new StreamInterruptedError('stream cut', 'coder-model');
    };
    const { loop, agent } = await bothEngines(9430, () => ({ ...base, userTurn: 'fix a.ts', stream }));
    expect(loop.cell.error).not.toBe('');
    expect(agent.cell.error).toBe(loop.cell.error);
    expect(agent.asked).toHaveLength(loop.asked.length);
  });

  it('carries the turn\'s tool_choice and the run\'s record alone in its tail (the transport applies what the surface says)', async () => {
    const seen: StreamOpts[] = [];
    const model = brainModelTransport({
      stream: async (opts) => { seen.push(opts); return { text: 'ok', toolCalls: [], finishReason: 'stop' }; },
      turn: {
        open: () => ({
          handlers: {}, maxTokens: undefined, toolChoice: 'required', tail: ['RECORD'],
          completed: () => undefined, failed: (e) => e,
        }),
      },
    });
    await model.complete({
      messages: [{ role: 'user', content: 'u' }, { role: 'user', content: '<run-state>\nFORCED BRIEF\n</run-state>' }],
      tools: [toolSpec('edit_file')] as never,
      toolChoice: 'auto',
    });
    expect(seen[0]!.tool_choice).toBe('required');
    expect(seen[0]!.messages.map((m) => String(m.content))).toEqual(['u', '<run-state>\nRECORD\n</run-state>']);
  });
});

describe('a vision turn reaches the wire as the host built it', () => {
  const picture: ContentPart[] = [{ type: 'text', text: 'what is this?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'low' } }];

  it('keeps [text, image, turn context] in order and the image detail, on every request', async () => {
    const { loop, agent } = await bothEngines(9440, () => ({ ...base, userTurn: picture, turnContext: async () => 'CONTEXT-BLOCK', stream: script([read(), answer('A cat.')]) }));
    const userRow = (o: Observed, at: number) => o.asked[at]!.messages.find((m) => m.role === 'user' && Array.isArray(m.content))?.content;
    expect(userRow(loop, 0)).toHaveLength(3);
    expect(userRow(agent, 0)).toEqual(userRow(loop, 0));
    expect(userRow(agent, 1)).toEqual(userRow(loop, 1));
  });

  it('round-trips through the agent\'s row shape', () => {
    const content: ContentPart[] = [...picture, { type: 'text', text: 'BLOCK' }];
    const row = toRunMessage({ role: 'user', content });
    expect(withImages(row.content, row.parts)).toEqual(content);
  });
});

describe('a call with no arguments is written as {}', () => {
  it('replays the call to the model with an empty object, as the loop\'s codec writes it', async () => {
    const noArgs = (): StreamChatResult => ({ text: '', toolCalls: [{ id: 'n1', name: 'read_file', args: '' }], finishReason: 'tool_calls', resolvedModel: 'm' });
    const { loop, agent } = await bothEngines(9450, () => ({ ...base, stream: script([noArgs, answer('Done.')]) }));
    const written = (o: Observed) => (o.asked[1]!.messages.find((m) => m.role === 'assistant') as { tool_calls?: Array<{ function: { arguments: string } }> }).tool_calls?.[0]?.function.arguments;
    expect(written(loop)).toBe('{}');
    expect(written(agent)).toBe('{}');
  });
});

describe('a narration that cannot be saved fails the run', () => {
  it('surfaces the persistence error as the loop does', async () => {
    const { loop, agent } = await bothEngines(9460, () => ({
      ...base,
      persistence: { sendMessages: async (_chat: number, msgs: Array<{ role: string }>) => { if (msgs.some((m) => m.role === 'assistant')) throw new Error('save failed'); return []; } } as never,
      stream: script([callTool('read_file', { path: 'a.ts' }, 'Reading it now.'), answer('Done.')]),
    }));
    expect(loop.cell.error).toBe('save failed');
    expect(agent.cell.error).toBe(loop.cell.error);
  });
});
