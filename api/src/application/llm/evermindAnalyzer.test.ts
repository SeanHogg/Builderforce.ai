import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../env';

/**
 * The analyzer's contract has three halves worth pinning:
 *   1. the LOCAL coherence screen condemns garbage for free (no frontier call), so an
 *      audit is useful with no teacher, no budget and no network;
 *   2. the frontier review is parsed defensively — a model that returns prose, fenced
 *      JSON or nonsense must degrade to "local findings + a warning", never throw;
 *   3. REPAIR is write-through: a bad memory is FORGOTTEN and its correction RE-TAUGHT
 *      under the same prompt, then merged. Forgetting without re-teaching (or the
 *      reverse) would leave the model in a worse state than before.
 */

const mocks = vi.hoisted(() => ({
  contributions: vi.fn(),
  head: vi.fn(),
  learnText: vi.fn(),
  forget: vi.fn(),
  flush: vi.fn(),
  complete: vi.fn(),
  readProxyChoice: vi.fn(),
  teacher: vi.fn(),
}));

vi.mock('./projectEvermind', () => ({
  getProjectEvermindContributions: mocks.contributions,
  getProjectEvermindHead: mocks.head,
  dispatchProjectEvermindLearnText: mocks.learnText,
  forgetProjectEvermindMemories: mocks.forget,
  flushProjectEvermind: mocks.flush,
}));
vi.mock('./LlmProxyService', () => ({
  llmProxyForPlan: () => ({ complete: mocks.complete }),
  readProxyChoice: mocks.readProxyChoice,
}));
vi.mock('./tenantProviderKeyService', () => ({
  resolveTenantLlmCredentials: async () => ({ anthropicOAuthToken: null, vendorKeys: {} }),
}));
vi.mock('./evermindTeacher', () => ({ resolveEvermindTeacherModel: mocks.teacher }));

const { analyzeProjectEvermindKnowledge, applyKnowledgeRepairs } = await import('./evermindAnalyzer');

const env = {} as Env;
const db = {} as never;

/** A learned memory as the inspection ring records it. */
const memory = (id: number, over: Record<string, unknown> = {}) => ({
  id, kind: 'text' as const, version: 3, at: 1, weight: 1,
  prompt: `task ${id}`,
  text: `A perfectly ordinary learned answer number ${id} about how the deployment pipeline works.`,
  ...over,
});

function contributions(recent: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) {
  return { version: 3, seeded: true, mode: 'connected', teacherModel: 'claude-opus-5', recent, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.teacher.mockResolvedValue({ model: 'claude-opus-5' });
  mocks.head.mockResolvedValue({ version: 3, mode: 'connected' });
  mocks.learnText.mockResolvedValue({ ok: true, status: 200, body: {} });
  mocks.forget.mockResolvedValue({ ok: true, status: 200, body: { forgotten: 1 } });
  mocks.flush.mockResolvedValue({ ok: true, status: 200, body: { merged: 1, version: 4 } });
  mocks.complete.mockResolvedValue({ response: { status: 200 }, resolvedModel: 'claude-opus-5' });
  mocks.readProxyChoice.mockResolvedValue({ content: '{"findings":[]}' });
});

describe('analyzeProjectEvermindKnowledge — local coherence screen', () => {
  it('condemns gibberish WITHOUT spending a frontier call on it', async () => {
    mocks.contributions.mockResolvedValue(contributions([
      memory(1, {
        text: 'Oredionisiing chats code related tot, bound reposea this inatic exie. A cainstiel was ore, '
          + 'thereb ancerin our propsal fromt bunted resole. Ther inatel sonce wortent flimber, and one '
          + 'grantile morest bindow will hance that trumal serite.',
      }),
    ]));
    const out = await analyzeProjectEvermindKnowledge(env, db, 7, 42);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.verdict).toBe('incoherent');
    expect(out.findings[0]?.source).toBe('coherence-gate');
    // Nothing survived the screen, so there was nothing left to review.
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('skips weight deltas — a diff carries no text to audit', async () => {
    mocks.contributions.mockResolvedValue(contributions([{ id: 9, kind: 'delta', version: 3, at: 1, weight: 1 }]));
    const out = await analyzeProjectEvermindKnowledge(env, db, 7, 42);
    expect(out.analyzed).toBe(0);
    expect(out.findings).toHaveLength(0);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});

describe('analyzeProjectEvermindKnowledge — frontier review', () => {
  it('returns per-memory verdicts and corrections', async () => {
    mocks.contributions.mockResolvedValue(contributions([memory(1), memory(2)]));
    mocks.readProxyChoice.mockResolvedValue({
      content: JSON.stringify({
        findings: [
          { id: 1, verdict: 'incorrect', issue: 'The retry limit is 3, not 30.', correction: 'The deployment pipeline retries a failed step three times before giving up.' },
          { id: 2, verdict: 'ok' },
        ],
      }),
    });
    const out = await analyzeProjectEvermindKnowledge(env, db, 7, 42);
    expect(out.model).toBe('claude-opus-5');
    expect(out.analyzed).toBe(2);
    // `ok` rows are not findings — only what needs attention is reported.
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ id: 1, verdict: 'incorrect', source: 'frontier' });
    expect(out.findings[0]?.correction).toMatch(/three times/);
  });

  it('parses fenced JSON with a preamble', async () => {
    mocks.contributions.mockResolvedValue(contributions([memory(1)]));
    mocks.readProxyChoice.mockResolvedValue({
      content: 'Here is my audit:\n```json\n{"findings":[{"id":1,"verdict":"outdated","issue":"Superseded."}]}\n```',
    });
    const out = await analyzeProjectEvermindKnowledge(env, db, 7, 42);
    expect(out.findings[0]?.verdict).toBe('outdated');
  });

  it('never attaches a correction to an unrepairable verdict', async () => {
    mocks.contributions.mockResolvedValue(contributions([memory(1)]));
    mocks.readProxyChoice.mockResolvedValue({
      content: JSON.stringify({ findings: [{ id: 1, verdict: 'unusable', issue: 'It is a stack trace.', correction: 'invented replacement' }] }),
    });
    const out = await analyzeProjectEvermindKnowledge(env, db, 7, 42);
    // `unusable`/`redundant` are dropped, never rewritten — a stray correction from the
    // reviewer must not become taught knowledge.
    expect(out.findings[0]?.correction).toBeUndefined();
  });

  it('degrades to local findings + a warning when the review model errors', async () => {
    mocks.contributions.mockResolvedValue(contributions([memory(1)]));
    mocks.complete.mockResolvedValue({ response: { status: 503 }, resolvedModel: '' });
    const out = await analyzeProjectEvermindKnowledge(env, db, 7, 42);
    expect(out.warning).toMatch(/503/);
    expect(out.findings).toHaveLength(0); // the memory was fine locally
  });

  it('degrades when the review model returns unusable output', async () => {
    mocks.contributions.mockResolvedValue(contributions([memory(1)]));
    mocks.readProxyChoice.mockResolvedValue({ content: 'I had a look and it seems mostly fine to me!' });
    const out = await analyzeProjectEvermindKnowledge(env, db, 7, 42);
    expect(out.warning).toMatch(/JSON/i);
  });

  it('never throws when the gateway call itself rejects', async () => {
    mocks.contributions.mockResolvedValue(contributions([memory(1)]));
    mocks.complete.mockRejectedValue(new Error('socket hang up'));
    const out = await analyzeProjectEvermindKnowledge(env, db, 7, 42);
    expect(out.warning).toMatch(/socket hang up/);
  });
});

describe('applyKnowledgeRepairs — write-through repair', () => {
  const finding = {
    id: 1, verdict: 'incorrect' as const, issue: 'wrong', prompt: 'How many retries?',
    excerpt: 'thirty retries', correction: 'The pipeline retries three times.', source: 'frontier' as const,
  };

  it('re-teaches the correction under the SAME prompt, forgets the old memory, and merges', async () => {
    const out = await applyKnowledgeRepairs(env, db, 7, 42, [finding]);
    expect(mocks.learnText).toHaveBeenCalledWith(env, 7, 42, finding.correction, undefined, finding.prompt);
    expect(mocks.forget).toHaveBeenCalledWith(env, 7, 42, [1]);
    expect(mocks.flush).toHaveBeenCalled();
    expect(out).toMatchObject({ corrected: 1, forgotten: 1, merged: 1, version: 4 });
  });

  it('forgets an unrepairable memory WITHOUT teaching anything', async () => {
    const out = await applyKnowledgeRepairs(env, db, 7, 42, [
      { id: 5, verdict: 'unusable', issue: 'stack trace', excerpt: '…', source: 'frontier' },
    ]);
    expect(mocks.learnText).not.toHaveBeenCalled();
    expect(mocks.forget).toHaveBeenCalledWith(env, 7, 42, [5]);
    // Nothing was taught, so there is nothing to merge.
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(out.corrected).toBe(0);
  });

  it('leaves `ok` findings entirely alone', async () => {
    const out = await applyKnowledgeRepairs(env, db, 7, 42, [
      { id: 2, verdict: 'ok', issue: '', excerpt: '…', source: 'frontier' },
    ]);
    expect(mocks.learnText).not.toHaveBeenCalled();
    expect(mocks.forget).not.toHaveBeenCalled();
    expect(out).toMatchObject({ corrected: 0, forgotten: 0 });
  });

  it('refuses to repair a FROZEN model rather than silently doing nothing', async () => {
    mocks.head.mockResolvedValue({ version: 3, mode: 'offline-frozen' });
    const out = await applyKnowledgeRepairs(env, db, 7, 42, [finding]);
    expect(mocks.learnText).not.toHaveBeenCalled();
    expect(mocks.forget).not.toHaveBeenCalled();
    expect(out.skipped[0]?.reason).toMatch(/frozen/i);
  });

  it('does NOT forget a memory whose correction failed to re-teach', async () => {
    // Forgetting here would destroy the old knowledge and put nothing in its place.
    mocks.learnText.mockResolvedValue({ ok: false, status: 503, body: { error: 'coordinator unavailable' } });
    const out = await applyKnowledgeRepairs(env, db, 7, 42, [finding]);
    expect(mocks.forget).toHaveBeenCalledWith(env, 7, 42, []);
    expect(out.skipped[0]).toMatchObject({ id: 1, reason: 'coordinator unavailable' });
  });
});
