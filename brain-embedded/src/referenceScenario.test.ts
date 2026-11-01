/**
 * The §8.4 reference scenario through the Brain's PRODUCTION path (PRD 35 §8.4): "Review `docs/specs/35-prd-one-agent-one-kernel.md`
 * and update it using sub-agents" on a 45 KB markdown PRD, started the way the editor starts it (`startRun` on the agent engine, the
 * parity harness's host: the model stream, persistence and tool port are the only fakes). This is the path where `readsCovered: true`
 * makes `callPreflight` stub a covered read, which is what ran on 2026-10-25; the core scenario
 * (`packages/agent-run/test/conformance/referenceScenario.test.ts`) proves the same budgets on the agent's own ports.
 *
 * The model is reactive: it reads one window a turn and spawns when - and only when - a read result carries the delegation
 * advisory, so the first spawn is measured off what the Brain's gate does, not off the script. Budgets: first spawn by parent turn 5,
 * at most 15 parent turns, the PRD actually edited, no covered-read stub for lines that were never served.
 * Live only (not faked): repo-resolution errors, shell reads of workspace files, a Stop settling in 2 s, the model named before turn 1.
 */

import { describe, expect, it } from 'vitest';
import { asksForSubagents } from '@builderforce/agent-run';
import { runScenario } from './run/parity/harness';
import { call, calls, completion, decide, reply } from './run/parity/script';
import type { Scenario } from './run/parity/types';

const PRD_PATH = 'docs/specs/35-prd-one-agent-one-kernel.md';
const PROMPT = `Review ${PRD_PATH} and update it using sub-agents.`;
const NUDGE = 'STOP READING AND DELEGATE';
const WINDOW = 100;

/** ~45 KB of markdown: headings every 40 lines, 70-character lines. */
const LINES = Array.from({ length: 660 }, (_, i) => (i % 40 === 0 ? `## Section ${i / 40 + 1}` : `Line ${i + 1}: ${'x'.repeat(60)}`));

interface Served { offset: number; limit: number }

function scenario(state: { doc: string }): Scenario {
  return {
    id: 'reference-scenario',
    rows: [],
    title: 'the section 8.4 reference scenario',
    async run(host) {
      host.tools({
        read_file: (args) => {
          const { offset = 1, limit = WINDOW } = args as Partial<Served>;
          const rows = state.doc.split('\n');
          return { ok: true, path: PRD_PATH, content: rows.slice(offset - 1, offset - 1 + limit).join('\n'), offset, totalLines: rows.length };
        },
        spawn_agents: () => ({ ok: true }),
        edit_file: (args) => {
          const { old_string, new_string } = args as { old_string: string; new_string: string };
          if (!state.doc.includes(old_string)) return { ok: false, error: 'old_string not found' };
          state.doc = state.doc.replace(old_string, new_string);
          return { ok: true };
        },
      });
      let read = 0;
      let spawned = 0;
      let edited = false;
      host.script([]);
      host.react(decide((input) => {
        const turn = input.call;
        const recent = input.opts.messages.slice(-3).map((m) => String(m.content)).join('\n');
        if (spawned) {
          // The turn after the spawn edits; the one after that answers. (Counted by state, not by call number: the Brain may re-ask a turn.)
          if (!edited) {
            edited = true;
            return completion({ toolCalls: [call('edit_file', { old_string: '## Section 1', new_string: '## Section 1 (reviewed)' }, `e${turn}`)], finishReason: 'tool_calls' });
          }
          return completion({ text: 'The PRD is reviewed and updated.' });
        }
        if (recent.includes(NUDGE)) {
          spawned = turn;
          return completion({ toolCalls: [call('spawn_agents', { workstreams: [{ label: 'WS2', task: 'Review section 2.' }] }, `s${turn}`)], finishReason: 'tool_calls' });
        }
        read += 1;
        // The third read re-reads lines the model has already been served.
        const args: Served = read === 3 ? { offset: 10, limit: 30 } : { offset: 1 + (read - 1) * WINDOW, limit: WINDOW };
        return completion({ toolCalls: [call('read_file', args, `r${turn}`)], finishReason: 'tool_calls' });
      }));
      await host.start({ userTurn: PROMPT, entryPoint: 'vscode', readsCovered: true });
    },
  };
}

describe('the section 8.4 reference scenario through the Brain on the agent engine', () => {
  it('requests delegation from the prompt, spawns by turn 5, finishes within 15 parent turns, and really edits the PRD', async () => {
    expect(asksForSubagents(PROMPT)).toBe(true);
    const state = { doc: LINES.join('\n') };
    const record = await runScenario(scenario(state), 'agent');

    expect(record.scenarioError).toBeUndefined();
    const names = record.host.toolCalls.map((t) => t.name);
    // One call a turn, so a call's position in the host's list is the parent turn that made it.
    const spawnTurn = names.indexOf('spawn_agents') + 1;
    expect(spawnTurn).toBeGreaterThan(0);
    expect(spawnTurn).toBeLessThanOrEqual(5);
    expect(record.wire.filter((w) => !w.summary).length).toBeLessThanOrEqual(15);
    expect(JSON.stringify(record.persisted.filter((m) => m.role === 'tool').slice(-4).map((m) => String(m.content).slice(0, 300)))).toBe('DBG');
    expect(names).toContain('edit_file');
    expect(state.doc).toContain('## Section 1 (reviewed)');
  });

  it('answers a re-read of served lines from coverage and never a window it was not served', async () => {
    const state = { doc: LINES.join('\n') };
    const record = await runScenario(scenario(state), 'agent');
    const trace = Object.values(record.trace).flat() as Array<{ category?: string; label?: string; args?: Served; result?: { covered?: boolean } }>;
    const reads = trace.filter((e) => e.category === 'tool' && e.label === 'read_file');
    const served: Array<[number, number]> = [];
    let stubs = 0;
    for (const read of reads) {
      const offset = read.args?.offset ?? 1;
      const last = offset + (read.args?.limit ?? WINDOW) - 1;
      if (!read.result?.covered) {
        served.push([offset, last]);
        continue;
      }
      stubs += 1;
      for (let line = offset; line <= last; line += 1) expect(served.some(([a, b]) => line >= a && line <= b), `line ${line} was stubbed as covered but never served`).toBe(true);
    }
    expect(reads.length).toBeGreaterThanOrEqual(4);
    // The re-read of lines 10-39 was answered from coverage, so the check above ran on a real stub.
    expect(stubs).toBeGreaterThan(0);
    void calls;
    void reply;
  });
});
