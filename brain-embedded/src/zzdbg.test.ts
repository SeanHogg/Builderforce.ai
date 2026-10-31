import { appendFileSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'vitest';
import { getRunTrace, getRunSnapshot, resetBrainRunStore, startRun, type BrainStreamFn } from './brainRunStore';
beforeEach(resetBrainRunStore);
const spec = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: {} } });
const TOOLS = ['read_file', 'spawn_agent', 'spawn_agents'].map(spec);
const lineage = { rootChatId: 4700, ownerKey: 4700, ownerName: 'BuilderForce', handle: 'a1', label: 'WS1', agent: { ref: 'subagent:WS1', name: 'WS1' }, depth: 1 };
const out = process.env.DBG_OUT ?? 'zzdbg.out.txt';
describe('dbg', () => {
  it('child', async () => {
    writeFileSync(out, '');
    let n = 0;
    const stream: BrainStreamFn = async (opts) => {
      n += 1;
      appendFileSync(out, `call ${n} role=${opts.role} tools=${(opts.tools ?? []).length} last=${JSON.stringify(opts.messages.at(-1)).slice(0, 160)}\n`);
      if (n > 40) throw new Error('too many');
      if (n <= 7) return { text: '', toolCalls: [{ id: `r${n}`, name: 'read_file', args: JSON.stringify({ path: `docs/file-${n}.md` }) }], finishReason: 'tool_calls' };
      return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
    };
    await startRun(-4701, { resolvedSystemPrompt: 'sys', tools: TOOLS, runTool: async (name: string, args: unknown) => ({ path: (args as { path?: string }).path, content: 'line', totalLines: 1 }), stream, persistence: { sendMessages: async () => [] }, userTurn: 'You are implementing WS1. Port the steering, ask and sub-agents policy module; children run as parallel agents.', lineage } as never);
    appendFileSync(out, 'ERR ' + String(getRunSnapshot(-4701)?.error) + '\nTRACE ' + JSON.stringify(getRunTrace(-4701).map((e) => e.label)).slice(0, 3000) + '\n');
  });
});
