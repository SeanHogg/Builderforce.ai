import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reconciliation wiring: assembled context → `EvermindCognition.commit()` → delta.
 *
 * The pure verdict logic is pinned in `@builderforce/run-context`'s own suite against a
 * faithful cognition double. What is pinned HERE is the seam this module owns:
 *   • surface-LOCAL blocks travel the same pipeline as the platform ones,
 *   • a cognition/store failure costs tokens, never context,
 *   • `elideUnchanged` defaults OFF, because all three surfaces rebuild their prompt.
 */

const assembleRunContext = vi.fn();
vi.mock('./runContextSource', async () => {
  const actual = await vi.importActual<typeof import('./runContextSource')>('./runContextSource');
  return { ...actual, assembleRunContext: (...a: unknown[]) => assembleRunContext(...a) };
});

let cognitionFactory: () => { commit: (c: unknown) => Promise<unknown>; version: number };
vi.mock('@seanhogg/builderforce-memory', () => ({
  EvermindCognition: class {
    private readonly impl = cognitionFactory();
    get version(): number { return this.impl.version; }
    commit(claim: unknown): Promise<unknown> { return this.impl.commit(claim); }
  },
}));

const { buildRunContext } = await import('./runContextService');

const env = {} as never;
const db = {} as never;

const envelope = (blocks: unknown[]) => ({
  contractVersion: 1,
  scope: 'task:3',
  projectId: 2,
  taskId: 3,
  generatedAt: '2026-08-20T00:00:00.000Z',
  blocks,
});

const platformBlock = { kind: 'prd', subject: 'prd:3', body: 'PRD', channel: 'user', order: 60, trustTier: 'tenant' };
const surfaceBlock = { kind: 'workspace', subject: 'ws:3', body: 'REPO', channel: 'user', order: 80, trustTier: 'repository' };

describe('buildRunContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assembleRunContext.mockResolvedValue(envelope([platformBlock]));
    cognitionFactory = () => {
      const store = new Map<string, string>();
      let version = 0;
      return {
        get version() { return version; },
        async commit(claim: unknown) {
          const c = claim as { subjectKey: string; content: string };
          const incumbent = store.get(c.subjectKey);
          if (incumbent === undefined) {
            store.set(c.subjectKey, c.content);
            version += 1;
            return { verdict: 'augment', subjectKey: c.subjectKey, content: c.content, evidence: [], version };
          }
          if (incumbent === c.content) {
            return { verdict: 'confirm', subjectKey: c.subjectKey, content: c.content, evidence: [], version };
          }
          store.set(c.subjectKey, c.content);
          version += 1;
          return { verdict: 'supersede', subjectKey: c.subjectKey, content: c.content, superseded: incumbent, evidence: [], version };
        },
      };
    };
  });

  it('routes surface-LOCAL blocks through the same reconciliation as platform ones', async () => {
    const out = await buildRunContext(env, db, {
      tenantId: 1, projectId: 2, taskId: 3, extraBlocks: [surfaceBlock] as never,
    });
    expect(out.full.blocks.map((b) => b.kind)).toEqual(['prd', 'workspace']);
    expect(out.envelope.blocks.map((b) => b.kind)).toEqual(['prd', 'workspace']);
    expect(out.reconciled?.blocks.every((b) => b.verdict === 'augment')).toBe(true);
  });

  it('keeps an unchanged block by default — the prompt is rebuilt, so eliding starves it', async () => {
    const shared = cognitionFactory();
    cognitionFactory = () => shared;
    await buildRunContext(env, db, { tenantId: 1, projectId: 2, taskId: 3 });
    const second = await buildRunContext(env, db, { tenantId: 1, projectId: 2, taskId: 3 });
    expect(second.envelope.blocks).toHaveLength(1);
    expect(second.unchanged).toEqual(['prd:3']);
  });

  it('elides an unchanged block when the caller owns a retained conversation', async () => {
    const shared = cognitionFactory();
    cognitionFactory = () => shared;
    await buildRunContext(env, db, { tenantId: 1, projectId: 2, taskId: 3, elideUnchanged: true });
    const second = await buildRunContext(env, db, { tenantId: 1, projectId: 2, taskId: 3, elideUnchanged: true });
    expect(second.envelope.blocks).toEqual([]);
    expect(second.unchanged).toEqual(['prd:3']);
  });

  it('marks a CHANGED block as a change rather than adding a competing statement', async () => {
    const shared = cognitionFactory();
    cognitionFactory = () => shared;
    await buildRunContext(env, db, { tenantId: 1, projectId: 2, taskId: 3 });
    assembleRunContext.mockResolvedValue(envelope([{ ...platformBlock, body: 'PRD v2' }]));
    const second = await buildRunContext(env, db, { tenantId: 1, projectId: 2, taskId: 3 });
    expect(second.envelope.blocks).toHaveLength(1);
    expect(second.envelope.blocks[0]?.body).toContain('PRD v2');
    expect(second.envelope.blocks[0]?.body).not.toContain('PRD\n');
    expect(second.reconciled?.blocks[0]?.verdict).toBe('supersede');
  });

  it('skips reconciliation entirely on request', async () => {
    const out = await buildRunContext(env, db, { tenantId: 1, projectId: 2, taskId: 3, reconcile: false });
    expect(out.reconciled).toBeUndefined();
    expect(out.envelope).toBe(out.full);
  });

  it('falls back to the FULL context when cognition is unavailable', async () => {
    cognitionFactory = () => ({ version: 0, commit: async () => { throw new Error('store offline'); } });
    const out = await buildRunContext(env, db, { tenantId: 1, projectId: 2, taskId: 3 });
    expect(out.envelope.blocks.map((b) => b.body)).toEqual(['PRD']);
  });
});
