import { describe, it, expect, vi } from 'vitest';
import {
  runOnce,
  runLoop,
  buildPrompt,
  DEFAULT_BROWSER_MODEL,
  type BrowserRuntimeTransport,
  type ClaimedDispatch,
} from './runner';

const dispatch = (over: Partial<ClaimedDispatch> = {}): ClaimedDispatch => ({
  dispatchId: 'd1',
  model: 'anthropic/claude-3-haiku',
  role: 'implementer',
  input: 'Build the thing',
  taskId: 7,
  ...over,
});

function fakeTransport(over: Partial<BrowserRuntimeTransport> = {}): BrowserRuntimeTransport {
  return {
    claim: vi.fn(async () => dispatch()),
    callModel: vi.fn(async () => 'model output'),
    report: vi.fn(async () => {}),
    openPullRequest: vi.fn(async () => null),
    ...over,
  };
}

describe('runOnce', () => {
  it('returns idle and does nothing when there is no work', async () => {
    const t = fakeTransport({ claim: vi.fn(async () => null) });
    expect(await runOnce(t)).toBe('idle');
    expect(t.callModel).not.toHaveBeenCalled();
    expect(t.report).not.toHaveBeenCalled();
  });

  it('runs the agent with its OWN model and reports completed with the output', async () => {
    const t = fakeTransport();
    expect(await runOnce(t)).toBe('completed');
    expect(t.callModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-3-haiku' }),
    );
    expect(t.report).toHaveBeenCalledWith('d1', { status: 'completed', output: 'model output' });
  });

  it('falls back to the default model when the assignment pinned none', async () => {
    const t = fakeTransport({ claim: vi.fn(async () => dispatch({ model: null })) });
    await runOnce(t);
    expect(t.callModel).toHaveBeenCalledWith(expect.objectContaining({ model: DEFAULT_BROWSER_MODEL }));
  });

  it('reports failed (never silently drops) when the model call throws', async () => {
    const t = fakeTransport({
      callModel: vi.fn(async () => {
        throw new Error('gateway 503');
      }),
    });
    expect(await runOnce(t)).toBe('failed');
    expect(t.report).toHaveBeenCalledWith('d1', { status: 'failed', error: 'gateway 503' });
  });
});

describe('runOnce — coding mode', () => {
  it('routes a repo-targeted dispatch to the code handler and reports its result', async () => {
    const code = vi.fn(async () => ({ status: 'completed' as const, output: 'pushed agentHost/task-1' }));
    const report = vi.fn(async () => {});
    const t = fakeTransport({
      claim: vi.fn(async () => dispatch({ repo: { repoId: 'r1', defaultBranch: 'main' } })),
      report,
    });
    expect(await runOnce(t, { code })).toBe('completed');
    expect(code).toHaveBeenCalled();
    expect(t.callModel).not.toHaveBeenCalled(); // coding path, not plain reasoning
    expect(report).toHaveBeenCalledWith('d1', { status: 'completed', output: 'pushed agentHost/task-1' });
  });

  it('reports failed when the code handler throws', async () => {
    const code = vi.fn(async () => {
      throw new Error('push rejected');
    });
    const report = vi.fn(async () => {});
    const t = fakeTransport({
      claim: vi.fn(async () => dispatch({ repo: { repoId: 'r1', defaultBranch: null } })),
      report,
    });
    expect(await runOnce(t, { code })).toBe('failed');
    expect(report).toHaveBeenCalledWith('d1', { status: 'failed', error: 'push rejected' });
  });

  it('falls back to reasoning when no repo is present even if a code handler exists', async () => {
    const code = vi.fn();
    const t = fakeTransport(); // dispatch has no repo
    expect(await runOnce(t, { code })).toBe('completed');
    expect(code).not.toHaveBeenCalled();
    expect(t.callModel).toHaveBeenCalled();
  });
});

describe('runLoop', () => {
  it('drains the queue until idle', async () => {
    let n = 0;
    const t = fakeTransport({
      claim: vi.fn(async () => (n++ < 2 ? dispatch({ dispatchId: `d${n}` }) : null)),
    });
    const outcomes = await runLoop(t);
    expect(outcomes).toEqual(['completed', 'completed', 'idle']);
    expect(t.report).toHaveBeenCalledTimes(2);
  });

  it('honors the maxIterations safety bound', async () => {
    const t = fakeTransport({ claim: vi.fn(async () => dispatch()) }); // never idle
    const outcomes = await runLoop(t, { maxIterations: 3 });
    expect(outcomes).toHaveLength(3);
  });
});

describe('buildPrompt', () => {
  it('includes the role and the task body', () => {
    const p = buildPrompt(dispatch({ role: 'reviewer', input: 'Review PR #4' }));
    expect(p).toContain('reviewer');
    expect(p).toContain('Review PR #4');
  });

  it('handles a missing task body', () => {
    expect(buildPrompt(dispatch({ input: null }))).toContain('No task description');
  });
});
