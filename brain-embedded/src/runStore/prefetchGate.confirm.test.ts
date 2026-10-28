import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineRegistry, prefetchConfirmOf, type PrefetchAction, type PrefetchPort } from '@builderforce/prefetch';
import { getCell } from './runCells';
import { resetBrainRunStore, resolveRunConfirm, stopRun } from './runControl';
import { answerDeterministically } from './prefetchGate';
import type { BrainRunRequest } from './runTypes';

/**
 * A PreFetch WRITE action is confirmed on the run's OWN confirm channel — the pending
 * confirm every surface renders as the confirm chip — never auto-run, and declined by Stop.
 */

const KEY = 41;

const writeRow: PrefetchAction = {
  id: 'format.apply', kind: 'answer', sideEffect: 'write', surfaces: ['vscode'], slash: '/format',
  examples: [], budgetMs: 1000, labelKey: 'prefetch.action.format.apply',
};

function setup() {
  const run = vi.fn(async () => ({ actionId: 'format.apply', text: 'Formatted 3 files.' }));
  const port: PrefetchPort = { registry: defineRegistry([writeRow]), executors: { 'format.apply': { run } }, ports: { surface: 'vscode' } };
  const c = getCell(KEY);
  c.abort = new AbortController();
  c.running = true;
  c.transcript.push({ role: 'user', content: '/format' });
  const sendMessages = vi.fn(async (_chatId: number, messages: Array<{ role: string; content: string }>) =>
    messages.map((m, i) => ({ id: i + 1, role: m.role, content: m.content }) as never));
  const req = { prefetch: port, persistence: { sendMessages } } as unknown as BrainRunRequest;
  return { c, req, run };
}

/** Wait until the gate has raised its confirm. */
async function pendingConfirm() {
  for (let i = 0; i < 50 && !getCell(KEY).pendingConfirm; i++) await new Promise((r) => setTimeout(r, 0));
  return getCell(KEY).pendingConfirm;
}

afterEach(() => resetBrainRunStore());

describe('the PreFetch confirm chip', () => {
  it('raises the action as the run\'s pending confirm and runs it only on Run', async () => {
    const { c, req, run } = setup();
    const gate = answerDeterministically(KEY, c, req, 'run-1', KEY);
    const pending = await pendingConfirm();
    expect(prefetchConfirmOf(pending)).toEqual({ actionId: 'format.apply', labelKey: 'prefetch.action.format.apply', request: '/format' });
    expect(run).not.toHaveBeenCalled();
    resolveRunConfirm(KEY, true);
    expect((await gate).answered).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(c.trace.find((e) => e.label === 'prefetch.decision')?.result).toMatchObject({ settled: 'answer', ran: [{ id: 'format.apply', ok: true, confirmed: true }] });
  });

  it('Dismiss declines: nothing runs and the turn goes on to the model', async () => {
    const { c, req, run } = setup();
    const gate = answerDeterministically(KEY, c, req, undefined, KEY);
    await pendingConfirm();
    resolveRunConfirm(KEY, false);
    expect((await gate).answered).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('Stop declines it and clears the chip', async () => {
    const { c, req, run } = setup();
    const gate = answerDeterministically(KEY, c, req, undefined, KEY);
    await pendingConfirm();
    stopRun(KEY);
    expect((await gate).answered).toBe(false);
    expect(getCell(KEY).pendingConfirm).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
