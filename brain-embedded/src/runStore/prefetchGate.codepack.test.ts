import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineRegistry, type PrefetchPort } from '@builderforce/prefetch';
import {
  SHARED_PREFETCH_ROWS, forgetCodePackFindings, offeredToolIds, sharedPrefetchExecutors, type DetectedTool,
} from '@builderforce/agent-tools/prefetch';
import type { CapabilityProvider } from '@builderforce/agent-tools';
import { makeCell } from './runCell';
import { answerDeterministically } from './prefetchGate';
import type { BrainRunRequest } from './runTypes';

/**
 * Done-check 2 (docs/design/deterministic-prefetch.md): `/dup` settles through the code
 * pack — the shared executor, the analyzers' output, memory's graph findings — with no
 * model call (`skippedLlm`), an avoided-call row, and the Open-in-graph chip on its step.
 */

const tool = (id: string, bin = id): DetectedTool => ({ id, via: 'dependency', command: `npm exec --no -- ${bin}` });

const DEPENDENCIES = { modules: [
  { source: 'src/a.ts', dependencies: [{ resolved: 'src/b.ts', circular: true }] },
  { source: 'src/b.ts', dependencies: [{ resolved: 'src/a.ts', circular: true }] },
] };
const DUPLICATES = { duplicates: [{ fragment: 'return input + 1;', firstFile: { name: 'src/a.ts', start: 2, end: 7 }, secondFile: { name: 'src/b.ts', start: 5, end: 10 } }] };
const UNUSED = { files: [], issues: [] };

function workspace(): { caps: CapabilityProvider; commands: string[] } {
  const commands: string[] = [];
  const caps = {
    capabilities: new Set(),
    shell: {
      run: async (command: string) => {
        commands.push(command);
        if (command.includes('depcruise')) return { ok: true, exitCode: 0, stdout: JSON.stringify(DEPENDENCIES) };
        if (command.includes('knip')) return { ok: true, exitCode: 0, stdout: JSON.stringify(UNUSED) };
        if (command.startsWith('git ')) return { ok: false, exitCode: 128, stdout: '' };
        return { ok: true, exitCode: 0, stdout: '' };
      },
    },
    repoRead: {
      readFile: async (path: string) => (path.endsWith('jscpd-report.json')
        ? { ok: true, path, content: JSON.stringify(DUPLICATES) }
        : { ok: false, path, error: 'file not found' }),
    },
  } as unknown as CapabilityProvider;
  return { caps, commands };
}

afterEach(() => forgetCodePackFindings());

describe('/dup through the gate', () => {
  it('settles via the code pack with skippedLlm and the Open in graph chip', async () => {
    const { caps } = workspace();
    const tools = new Map([['jscpd', tool('jscpd')], ['knip', tool('knip')], ['dependency-cruiser', tool('dependency-cruiser', 'depcruise')]]);
    const port: PrefetchPort = {
      registry: defineRegistry([...SHARED_PREFETCH_ROWS]),
      executors: sharedPrefetchExecutors({ caps, tools: () => tools, rootId: 'ws' }),
      ports: { surface: 'vscode', tools: offeredToolIds(tools) },
    };
    const c = makeCell();
    c.transcript.push({ role: 'user', content: '/dup' });
    const sendMessages = vi.fn(async (_chatId: number, messages: Array<{ role: string; content: string }>) =>
      messages.map((m, i) => ({ id: i + 1, role: m.role, content: m.content }) as never));
    const recordAvoidedCall = vi.fn();
    const req = { prefetch: port, persistence: { sendMessages }, recordAvoidedCall } as unknown as BrainRunRequest;

    const gate = await answerDeterministically(1, c, req, 'run-dup');
    expect(gate.answered).toBe(true);
    const [, sent] = sendMessages.mock.calls[0]!;
    expect(sent[0]!.content).toContain('1 duplicate-code group(s)');
    const step = c.trace.find((e) => e.label === 'dup.check');
    expect(step?.result).toMatchObject({
      skippedLlm: true,
      route: 'answer',
      chips: [{ labelKey: 'prefetch.chip.openInGraph', command: 'builderforce.openKnowledgeGraph', args: { focus: ['src:ws::src/a.ts', 'src:ws::src/b.ts'] } }],
    });
    expect(recordAvoidedCall).toHaveBeenCalledWith(expect.objectContaining({ source: 'deterministic', actionId: 'dup.check', runId: 'run-dup' }));
  });

  it('is not offered when jscpd is not installed: the turn goes on to the model', async () => {
    const { caps, commands } = workspace();
    const port: PrefetchPort = {
      registry: defineRegistry([...SHARED_PREFETCH_ROWS]),
      executors: sharedPrefetchExecutors({ caps, tools: () => new Map(), rootId: 'ws' }),
      ports: { surface: 'vscode', tools: offeredToolIds(new Map()) },
    };
    const c = makeCell();
    c.transcript.push({ role: 'user', content: '/dup' });
    const req = { prefetch: port, persistence: { sendMessages: vi.fn() } } as unknown as BrainRunRequest;
    expect((await answerDeterministically(1, c, req)).answered).toBe(false);
    expect(commands).toEqual([]);
  });
});
