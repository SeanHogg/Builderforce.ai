import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The ONE ContextSource: what a run is told, and in what order.
 *
 * The register entry this closes said on-prem and VS Code runs were "starved of
 * strategic/PRD/governance context". The measurement was worse than that — STRATEGY was
 * missing from all three surfaces, including the cloud, which is why an agent was told to
 * call `builtin_objectives_update` while having been shown no objective. These tests pin
 * the block set and the render order so a surface cannot silently regress to a subset.
 */

const getOrSetCached = vi.fn();
const getCacheVersion = vi.fn();
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  getOrSetCached: (...a: unknown[]) => getOrSetCached(...a),
  getCacheVersion: (...a: unknown[]) => getCacheVersion(...a),
}));

const findTaskPrimarySpec = vi.fn();
vi.mock('../prd/taskPrd', () => ({ findTaskPrimarySpec: (...a: unknown[]) => findTaskPrimarySpec(...a) }));

const buildProjectFactsBlock = vi.fn();
vi.mock('../llm/projectFacts', () => ({ buildProjectFactsBlock: (...a: unknown[]) => buildProjectFactsBlock(...a) }));

const buildEvermindLessonsBlock = vi.fn();
vi.mock('../llm/projectEvermind', () => ({ buildEvermindLessonsBlock: (...a: unknown[]) => buildEvermindLessonsBlock(...a) }));

const { assembleRunContext, runContextScope, RUN_CONTEXT_ORDER } = await import('./runContextSource');
const { renderRunContext } = await import('@builderforce/run-context');

const env = {} as never;
const db = {} as never;

/** Both cached loaders are served from ONE fake keyed by the cache-key prefix. */
function cacheReturns(values: { strategy?: string; governance?: string }): void {
  getOrSetCached.mockImplementation(async (_env: unknown, key: string) => {
    if (String(key).startsWith('run-context:strategy:')) return values.strategy ?? '';
    if (String(key).startsWith('run-context:governance:')) return values.governance ?? '';
    return '';
  });
}

describe('assembleRunContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCacheVersion.mockResolvedValue('v1');
    cacheReturns({});
    findTaskPrimarySpec.mockResolvedValue(null);
    buildProjectFactsBlock.mockResolvedValue('');
    buildEvermindLessonsBlock.mockResolvedValue('');
  });

  it('carries strategy, PRD, governance, task, memory and lessons — the full platform set', async () => {
    cacheReturns({ strategy: '## Strategic objectives this work serves\n\nOKR', governance: '## Project Rules\n\nRULES' });
    findTaskPrimarySpec.mockResolvedValue({ id: 's1', prd: 'PRD BODY' });
    buildProjectFactsBlock.mockResolvedValue('FACTS');
    buildEvermindLessonsBlock.mockResolvedValue('LESSONS');

    const env0 = await assembleRunContext(env, db, {
      tenantId: 1,
      projectId: 2,
      taskId: 3,
      task: { id: 3, title: 'Ship auth', description: 'do it' },
    });

    expect(env0.blocks.map((b) => b.kind)).toEqual(['strategy', 'prd', 'governance', 'task', 'memory', 'lessons']);
    expect(env0.scope).toBe('task:3');
  });

  it('renders strategy BEFORE the PRD and the ticket LAST, in the cloud prompt shape', async () => {
    cacheReturns({ strategy: 'STRATEGY', governance: 'GOVERNANCE' });
    findTaskPrimarySpec.mockResolvedValue({ id: 's1', prd: 'PRD BODY' });

    const assembled = await assembleRunContext(env, db, {
      tenantId: 1, projectId: 2, taskId: 3,
      task: { id: 3, title: 'Ship auth', description: null },
    });
    const { userContent } = renderRunContext(assembled);

    expect(userContent.indexOf('STRATEGY')).toBeLessThan(userContent.indexOf('PRD BODY'));
    expect(userContent.indexOf('PRD BODY')).toBeLessThan(userContent.indexOf('GOVERNANCE'));
    expect(userContent.indexOf('GOVERNANCE')).toBeLessThan(userContent.indexOf('Ship auth'));
    // The separator the cloud prompt has always used between user-channel blocks.
    expect(userContent).toContain('\n\n---\n\n');
  });

  it('omits every block that has nothing to say', async () => {
    const assembled = await assembleRunContext(env, db, { tenantId: 1, projectId: 2 });
    expect(assembled.blocks).toEqual([]);
    expect(assembled.scope).toBe('project:2');
  });

  it('NEVER drafts a PRD for a non-cloud surface — it reads the stored one', async () => {
    findTaskPrimarySpec.mockResolvedValue({ id: 's1', prd: 'STORED PRD' });
    const assembled = await assembleRunContext(env, db, { tenantId: 1, projectId: 2, taskId: 3 });
    expect(findTaskPrimarySpec).toHaveBeenCalledWith(db, 3);
    expect(assembled.blocks.find((b) => b.kind === 'prd')?.body).toContain('STORED PRD');
  });

  it('accepts the cloud engine\'s in-flight PRD promise so the draft stays overlapped', async () => {
    const assembled = await assembleRunContext(env, db, {
      tenantId: 1, projectId: 2, taskId: 3,
      prd: Promise.resolve('FRESHLY DRAFTED'),
    });
    // The stored-PRD read must not run when the caller already owns one.
    expect(findTaskPrimarySpec).not.toHaveBeenCalled();
    expect(assembled.blocks.find((b) => b.kind === 'prd')?.body).toContain('FRESHLY DRAFTED');
  });

  it('pins the ticket so the reconciler can never elide the goal', async () => {
    const assembled = await assembleRunContext(env, db, {
      tenantId: 1, projectId: 2, taskId: 3,
      task: { id: 3, title: 'Ship auth', description: null },
    });
    expect(assembled.blocks.find((b) => b.kind === 'task')?.pinned).toBe(true);
  });

  it('puts memory and lessons on the SYSTEM channel and the rest on the user turn', async () => {
    cacheReturns({ strategy: 'STRATEGY' });
    buildProjectFactsBlock.mockResolvedValue('FACTS');
    buildEvermindLessonsBlock.mockResolvedValue('LESSONS');
    const assembled = await assembleRunContext(env, db, { tenantId: 1, projectId: 2 });
    const channels = Object.fromEntries(assembled.blocks.map((b) => [b.kind, b.channel]));
    expect(channels).toEqual({ strategy: 'user', memory: 'system', lessons: 'system' });
  });

  it('serves strategy and governance through the read-through cache, versioned', async () => {
    await assembleRunContext(env, db, { tenantId: 1, projectId: 2, taskId: 3, agentRef: 'agent-9' });
    const keys = getOrSetCached.mock.calls.map((c) => String(c[1]));
    expect(keys).toContain('run-context:strategy:1:2:3:v1');
    expect(keys).toContain('run-context:governance:1:2:agent-9:v1');
  });

  it('survives a total read failure rather than failing the run', async () => {
    getOrSetCached.mockRejectedValue(new Error('kv down'));
    findTaskPrimarySpec.mockRejectedValue(new Error('db down'));
    buildProjectFactsBlock.mockRejectedValue(new Error('db down'));
    buildEvermindLessonsBlock.mockRejectedValue(new Error('db down'));
    const assembled = await assembleRunContext(env, db, { tenantId: 1, projectId: 2, taskId: 3 });
    expect(assembled.blocks).toEqual([]);
  });
});

describe('runContextScope', () => {
  it('prefers an explicit scope, then the ticket, then the project', () => {
    expect(runContextScope({ projectId: 2, scope: 'chat:9' })).toBe('chat:9');
    expect(runContextScope({ projectId: 2, taskId: 3 })).toBe('task:3');
    expect(runContextScope({ projectId: 2 })).toBe('project:2');
  });
});

describe('RUN_CONTEXT_ORDER', () => {
  it('places strategy between the headline directives and the PRD', () => {
    expect(RUN_CONTEXT_ORDER.followUp).toBeLessThan(RUN_CONTEXT_ORDER.strategy);
    expect(RUN_CONTEXT_ORDER.strategy).toBeLessThan(RUN_CONTEXT_ORDER.prd);
  });
});
