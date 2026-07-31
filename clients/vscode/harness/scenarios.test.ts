/**
 * Regression tests for the VSIX chat, run against the REAL brain loop with a scripted
 * gateway. Every one of these reproduces a failure that previously could only be seen by
 * building a `.vsix`, installing it, reproducing the chat by hand and pasting the output.
 *
 * They assert on two things:
 *   1. what the loop DID (tool dispatches, re-prompts, model swaps);
 *   2. what a copied report would SAY about it — because when the loop cannot save a
 *      run, an accurate diagnosis is the whole remaining product.
 */

import { describe, expect, it } from 'vitest';
import { runScenario } from './runScenario';
import { scenarioById, SCENARIOS } from './scenarios';

/** Fetch a scenario by id, failing loudly if the catalogue and the tests drift apart. */
function scenario(id: string) {
  const s = scenarioById(id);
  if (!s) throw new Error(`unknown scenario: ${id}`);
  return s;
}

describe('a model that narrates tool calls instead of making them', () => {
  it('is caught, re-prompted, and reported as such — never presented as an answer', async () => {
    const run = await runScenario(scenario('narrates-forever'));

    expect(run.toolCalls).toHaveLength(0);
    // The loop must fight it rather than accept the first promise as the final answer.
    expect(run.diagnostics.stallRecoveries).toBeGreaterThan(0);
    expect(run.diagnostics.stallUnrecovered).toBe(true);
    expect(run.diagnostics.announcedUnmadeToolCall).toBe(true);
    expect(run.diagnostics.likelyCause).toBe('tool-calls-not-emitted');
    // And it must never read as a clean run, which is exactly what it used to do.
    expect(run.diagnostics.likelyCause).not.toBe('healthy');
    expect(run.error).toMatch(/described tool calls instead of making them/i);

    // The pasted report has to carry the verdict AND the evidence for it.
    expect(run.transcript).toContain('TOOL CALLS NOT EMITTED');
    expect(run.transcript).toMatch(/Stall handling: \d+ re-prompt\(s\)/);
    expect(run.transcript).toMatch(/Tools advertised per turn: \d+/);
  });

  it('catches the bare pseudo-call form the model degrades into', async () => {
    const run = await runScenario(scenario('pseudo-call-text'));

    // `call builtin_x with chatId is 85` carries no first-person promise — it used to
    // score as a complete answer and end the run silently.
    expect(run.diagnostics.announcedUnmadeToolCall).toBe(true);
    expect(run.diagnostics.stallRecoveries).toBeGreaterThan(0);
    expect(run.diagnostics.likelyCause).toBe('tool-calls-not-emitted');
  });

  it('recovers the run when the re-prompt lands', async () => {
    const run = await runScenario(scenario('narrates-then-acts'));

    expect(run.diagnostics.stallRecoveries).toBe(1);
    expect(run.diagnostics.stallUnrecovered).toBe(false);
    expect(run.toolCalls.map((c) => c.name)).toContain('builtin_chats_list_tickets');
    // The re-prompt must be the thing that produced the call. Asserted on the two
    // clauses that ARE the contract — it names the failure and demands the call this
    // turn — rather than on a passing phrase: this line pinned wording the nudge had
    // already moved past, so it failed for a rewording while saying nothing about
    // whether recovery worked.
    expect(run.requests[1].lastUserText).toMatch(/zero tool calls/i);
    expect(run.requests[1].lastUserText).toMatch(/make the call now in this turn/i);
    expect(run.error).toBe('');
  });

  it('switches models when re-prompting the first one is spent', async () => {
    const run = await runScenario(scenario('failover-rescues'));

    expect(run.diagnostics.modelFailovers).toBe(1);
    expect(run.toolCalls.map((c) => c.name)).toContain('builtin_chats_list_tickets');
    expect(run.requests.some((r) => r.requestedModel === 'anthropic/claude-sonnet-5')).toBe(true);
    expect(run.transcript).toMatch(/model failover\(s\)/);
    // A run the loop RESCUED must read as rescued. The loop's own deliberate model
    // swap is not a gateway downgrade, and counting it as one made every successful
    // failover report "likely context exhaustion".
    expect(run.diagnostics.downgradeEvents).toBe(0);
    expect(run.diagnostics.likelyCause).toBe('healthy');
  });
});

describe('inline tool-call dialects', () => {
  it('lifts `<tool_call>` markup into a real call and keeps it out of the visible text', async () => {
    const run = await runScenario(scenario('xml-dialect'));

    expect(run.toolCalls.map((c) => c.name)).toContain('builtin_chats_list_tickets');
    expect(run.toolCalls[0].args).toEqual({ chatId: 85 });
    // The user must never see the raw markup in a chat bubble. Asserted on the persisted
    // turns rather than the whole document, because the scenario's own title quotes the
    // markup it is about.
    const assistantText = run.messages.filter((m) => m.role === 'assistant').map((m) => m.content).join('\n');
    expect(assistantText).toContain('Looking that up.');
    expect(assistantText).not.toContain('<tool_call>');
    expect(assistantText).not.toContain('<arg_key>');
  });
});

describe('when the fault is ours, the report must say so', () => {
  it('names a failed tool catalog rather than blaming the model', async () => {
    const run = await runScenario(scenario('no-tools-advertised'));

    expect(run.diagnostics.advertisedToolsMin).toBe(0);
    expect(run.diagnostics.likelyCause).toBe('no-tools-advertised');
    expect(run.transcript).toContain('NO TOOLS ADVERTISED');
    // The old advice would have been actively wrong here.
    expect(run.transcript).toContain('Switching models will not help.');
  });

  it('names a tool the selection dropped, instead of "the model will not call tools"', async () => {
    const run = await runScenario(scenario('tool-not-advertised'));

    expect(run.diagnostics.narratedUnadvertisedTools).toContain('builtin_chats_list_tickets');
    expect(run.diagnostics.likelyCause).toBe('tool-not-advertised');
    expect(run.transcript).toContain('TOOL NOT ADVERTISED');
    expect(run.transcript).toContain('Narrated but never advertised: builtin_chats_list_tickets');
  });
});

describe('structural honesty flags', () => {
  it('flags a claimed file write that no tool performed', async () => {
    const run = await runScenario(scenario('unbacked-write-claim'));
    expect(run.transcript).toContain('UNBACKED WRITE CLAIM');
  });

  it('flags a claimed ticket that no tool created or linked', async () => {
    const run = await runScenario(scenario('unbacked-ticket-claim'));
    expect(run.transcript).toContain('UNBACKED TICKET CLAIM');
  });
});

describe('context pressure', () => {
  it('separates a window blow-out from a model that simply produced nothing', async () => {
    const run = await runScenario(scenario('context-exhaustion'));

    expect(run.diagnostics.truncatedToolResults).toBeGreaterThan(0);
    expect(run.diagnostics.downgradeEvents).toBeGreaterThan(0);
    expect(run.diagnostics.likelyCause).toBe('context-exhaustion');
    expect(run.transcript).toContain('CONTEXT EXHAUSTION');
    expect(run.transcript).toMatch(/truncated before the model saw them/);
  });

  it('forces a prose answer when the tool budget runs out instead of dying', async () => {
    const run = await runScenario(scenario('tool-budget-exhausted'));

    // The closing synthesis turn is the one sent with no tools at all.
    expect(run.requests.some((r) => r.toolless)).toBe(true);
    const last = run.messages.filter((m) => m.role === 'assistant').at(-1);
    expect(last?.content).toMatch(/ran out of budget/i);
    expect(run.diagnostics.loopExhausted).toBe(false);
  });
});

describe('transport failures', () => {
  it('surfaces a gateway error to the user', async () => {
    const run = await runScenario(scenario('gateway-error'));
    expect(run.events.some((e) => e.isError && e.label === 'llm.complete')).toBe(true);
    expect(run.transcript).toMatch(/validated card on file/);
  });
});

describe('the healthy control', () => {
  it('runs a normal chat clean and says nothing needs triaging', async () => {
    const run = await runScenario(scenario('healthy-baseline'));

    expect(run.toolCalls.map((c) => c.name)).toEqual(['builtin_projects_list']);
    expect(run.diagnostics.likelyCause).toBe('healthy');
    expect(run.diagnostics.stallRecoveries).toBe(0);
    expect(run.transcript).toContain('No failure signal');
  });
});

describe('the catalogue itself', () => {
  it('every scenario runs to completion and produces a copyable report', async () => {
    for (const s of SCENARIOS) {
      const run = await runScenario(s);
      expect(run.transcript, s.id).toContain('# BuilderForce chat transcript');
      expect(run.transcript, s.id).toContain('--- Diagnostics ---');
      // The web surface's capture must stay in step with the VSIX one.
      expect(run.triageReport, s.id).toContain('--- Diagnostics ---');
    }
  });
});
