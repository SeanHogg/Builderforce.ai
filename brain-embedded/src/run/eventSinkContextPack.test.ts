import { describe, expect, it } from 'vitest';
import { defaultEstimateTokens } from '@seanhogg/builderforce-memory/handoff';
import type { RunOutcomeRow } from '@builderforce/agent-run';
import { makeCell } from '../runStore/runCell';
import { attachTurnContext, turnContextBlock } from '../runStore/turnContext';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { brainEventSink } from './eventSink';

/** The agent's row for a Brain run: its context pack is empty, so it measured 0. */
const agentRow = { entryPoint: 'vscode', steps: 3, contextPackTokens: 0 } as RunOutcomeRow;

async function reported(attach: string | null): Promise<RunOutcomeRow> {
  const c = makeCell();
  if (attach !== null) attachTurnContext(c, [{ role: 'user', content: 'do it' } as ChatCompletionMessage], attach);
  const rows: RunOutcomeRow[] = [];
  await brainEventSink(c, (row) => void rows.push(row)).outcome!(agentRow);
  return rows[0]!;
}

describe('the outcome row\'s contextPackTokens (§8.2)', () => {
  it('is the token estimate of the turn-context block the run sent', async () => {
    const block = turnContextBlock(['### Focus file `docs/a.md` (2 lines, whole file)\none\ntwo'])!;
    const row = await reported(block);
    expect(row.contextPackTokens).toBe(defaultEstimateTokens(block));
    expect(row.contextPackTokens).toBeGreaterThan(0);
  });

  it('stays 0 for a run that sent no turn-context block', async () => {
    expect((await reported(null)).contextPackTokens).toBe(0);
  });
});
