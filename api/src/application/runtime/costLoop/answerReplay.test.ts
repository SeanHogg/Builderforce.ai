import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCapability } from '@builderforce/agent-tools';

const h = vi.hoisted(() => ({ replay: vi.fn() }));
vi.mock('../../llm/agentAnswerReplay', () => ({ replayAgentAnswer: h.replay }));

import { withAnswerReplay } from './answerReplay';
import { CLOUD_RUN_TENANT_ROLE } from '../cloudAgentTools';

const ON = { COST_LEVER_B4_AGENT_ANSWER_REPLAY: 'on' };
function memory(): MemoryCapability & { recall: ReturnType<typeof vi.fn> } {
  return {
    remember: vi.fn(async () => ({ ok: true })),
    recall: vi.fn(async (query: string) => ({ ok: true, query, entries: [{ key: 'k', content: 'stored' }] })),
  } as never;
}

beforeEach(() => h.replay.mockReset());

describe('withAnswerReplay (B4)', () => {
  it('returns a replayed answer, marked, without the recall round trip', async () => {
    h.replay.mockResolvedValue({ answer: 'Auth lives in api/src/auth.', source: 'memory' });
    const m = memory();
    const r = await withAnswerReplay(m, { env: ON, db: {}, tenantId: 4, projectId: 12, agentRef: 'agent-1' }).recall('where is auth?');
    expect(r).toMatchObject({ ok: true, replayed: true, entries: [{ content: 'Auth lives in api/src/auth.' }] });
    expect(m.recall).not.toHaveBeenCalled();
    expect(h.replay).toHaveBeenCalledWith(ON, {}, expect.objectContaining({ tenantId: 4, projectId: 12, question: 'where is auth?', principal: { agentHostId: 'agent-1', userId: null, role: CLOUD_RUN_TENANT_ROLE } }));
  });

  it('falls through to the real recall on a miss', async () => {
    h.replay.mockResolvedValue(null);
    const m = memory();
    const r = await withAnswerReplay(m, { env: ON, db: {}, tenantId: 4, projectId: 12 }).recall('q', 3);
    expect(r.entries?.[0]?.content).toBe('stored');
    expect(m.recall).toHaveBeenCalledWith('q', 3);
  });

  it('is the capability itself with the lever off', () => {
    const m = memory();
    expect(withAnswerReplay(m, { env: { COST_LEVERS_ALL: 'off' }, db: {}, tenantId: 4, projectId: 12 })).toBe(m);
  });
});
