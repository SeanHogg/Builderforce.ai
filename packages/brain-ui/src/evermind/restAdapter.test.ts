import { describe, expect, it } from 'vitest';
import {
  createEvermindRestAdapter,
  groupAbsorbed,
  loadEvermindBuilds,
  planIsPaid,
  preferredEvermindBuild,
  resolveTeacherOptions,
  type EvermindBuild,
  type EvermindRequest,
} from './restAdapter';

type Call = { path: string; method: string; body: unknown };

/** A recording request that answers from a path → reply table. */
function recorder(replies: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const request: EvermindRequest = async <T,>(path: string, init?: { method?: string; body?: string }) => {
    calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    return (replies[path] ?? {}) as T;
  };
  return { calls, request };
}

describe('createEvermindRestAdapter', () => {
  it('scopes every call to the storage project and sends the documented method and body', async () => {
    const { calls, request } = recorder({ '/api/projects/7/evermind/flush': { merged: 3, version: 12 } });
    const a = createEvermindRestAdapter({ request, projectId: 7 });
    await a.loadData();
    await a.setInference(true);
    await a.setMode('offline-frozen');
    await a.teach('taught text', 'the task');
    expect(await a.flush()).toEqual({ merged: 3, version: 12 });
    await a.probe!();
    await a.reseed!('evermind-base');
    expect(calls).toEqual([
      { path: '/api/projects/7/evermind/contributions', method: 'GET', body: undefined },
      { path: '/api/projects/7/evermind/inference', method: 'PATCH', body: { enabled: true } },
      { path: '/api/projects/7/evermind/mode', method: 'PATCH', body: { mode: 'offline-frozen' } },
      { path: '/api/projects/7/evermind/learn-text', method: 'POST', body: { text: 'taught text', prompt: 'the task' } },
      { path: '/api/projects/7/evermind/flush', method: 'POST', body: undefined },
      { path: '/api/projects/7/evermind/probe', method: 'POST', body: {} },
      { path: '/api/projects/7/evermind/reseed', method: 'POST', body: { slug: 'evermind-base' } },
    ]);
  });

  it('hands back the contribution id so the console can poll what the merge did', async () => {
    const { request } = recorder({ '/api/projects/1/evermind/learn-text': { contributionId: 44 } });
    expect(await createEvermindRestAdapter({ request, projectId: 1 }).teach('x')).toEqual({ contributionId: 44 });
  });

  it('offers only published Evermind models as seeds, and reads the paid verdict off the plan snapshot', async () => {
    const { request } = recorder({
      '/api/llm/models': { models: [{ slug: 'a', name: ' Alpha ', baseModel: 'evermind/base' }, { slug: 'b', baseModel: 'openai/gpt' }] },
      '/llm/v1/models': { codingModels: ['m1'], premium: true, effectivePlan: 'pro' },
      '/api/consumption': { plan: { effective: 'free' } },
    });
    const a = createEvermindRestAdapter({ request, projectId: 1 });
    expect(await a.loadSeedModels()).toEqual([{ slug: 'a', name: 'Alpha' }]);
    // `premium`/`effectivePlan` are not the verdict; with no frontier verdict and a free
    // plan the teacher stays locked, and a locked picker offers nothing.
    expect(await a.loadTeacherOptions()).toEqual({ models: [], isPaid: false });
  });

  it('unlocks the teacher on the server frontier verdict (BYO / superadmin), offering its teacher models', async () => {
    const { request } = recorder({
      '/llm/v1/models': { canUseFrontierModels: true, teacherModels: ['anthropic/claude-opus'], codingModels: ['m1'] },
      '/api/consumption': { plan: { effective: 'free' } },
    });
    expect(await createEvermindRestAdapter({ request, projectId: 1 }).loadTeacherOptions()).toEqual({
      models: ['anthropic/claude-opus'],
      isPaid: true,
    });
  });

  it('marks the statuses the console reports itself, so a host keeps them off its global error surface', async () => {
    const seen: Array<{ path: string; expectedErrors?: number[] }> = [];
    const request: EvermindRequest = async <T,>(path: string, init?: { expectedErrors?: number[] }) => {
      seen.push({ path, expectedErrors: init?.expectedErrors });
      return {} as T;
    };
    const a = createEvermindRestAdapter({ request, projectId: 5 });
    await a.probe!();
    await a.analyze!();
    await a.setInference(false);
    await a.flush();
    expect(seen).toEqual([
      { path: '/api/projects/5/evermind/probe', expectedErrors: [409, 422] },
      { path: '/api/projects/5/evermind/analyze', expectedErrors: [402] },
      { path: '/api/projects/5/evermind/inference', expectedErrors: [422] },
      { path: '/api/projects/5/evermind/flush', expectedErrors: undefined },
    ]);
  });

  it('offers import only when the host can both read and compact its memory source', async () => {
    const { request } = recorder();
    expect(createEvermindRestAdapter({ request, projectId: 1 }).importMemory).toBeUndefined();
    expect(createEvermindRestAdapter({ request, projectId: 1, pickMemory: async () => null }).importMemory).toBeUndefined();
  });

  it('imports: absorbs the picked entries, then compacts exactly the absorbed ones where they live', async () => {
    const { calls, request } = recorder({
      '/api/projects/3/evermind/extract-memories': { absorbed: ['k1', 'k3'], skipped: [{ key: 'k2', reason: 'short' }], merged: 2, version: 9 },
    });
    let compacted: unknown = null;
    const a = createEvermindRestAdapter({
      request,
      projectId: 3,
      pickMemory: async () => ({ path: 'store', fileName: 'Synapse', entries: [{ key: 'k1', text: 'one' }, { key: 'k2', text: 'two' }, { key: 'k3', text: 'three' }] }),
      compactMemory: async (req) => {
        compacted = req;
        return { compacted: 2, bytesSaved: 120 };
      },
    });
    expect(await a.importMemory!()).toEqual({ fileName: 'Synapse', absorbed: 2, skipped: 1, merged: 2, version: 9, compacted: 2, bytesSaved: 120 });
    expect(calls[0].body).toEqual({ entries: [{ key: 'k1', text: 'one' }, { key: 'k2', text: 'two' }, { key: 'k3', text: 'three' }] });
    expect(compacted).toEqual({ files: [{ path: 'store', absorbedKeys: ['k1', 'k3'] }], version: 9 });
  });
});

describe('groupAbsorbed', () => {
  it('groups by each entry’s own source, falling back to the picked one', () => {
    const picked = { path: 'dir', fileName: 'dir', entries: [{ key: 'a', text: '', path: 'a.md' }, { key: 'b', text: '', path: 'b.md' }, { key: 'c', text: '' }] };
    expect(groupAbsorbed(picked, ['a', 'c'])).toEqual([{ path: 'a.md', absorbedKeys: ['a'] }, { path: 'dir', absorbedKeys: ['c'] }]);
  });
});

describe('resolveTeacherOptions', () => {
  it('falls back to the coding pool on an older payload once a paid plan unlocks it', () => {
    expect(resolveTeacherOptions({ codingModels: ['m1'] }, { plan: { effective: 'pro' } })).toEqual({ models: ['m1'], isPaid: true });
    expect(resolveTeacherOptions(null, null)).toEqual({ models: [], isPaid: false });
  });
});

describe('planIsPaid', () => {
  it('is paid only for a readable non-free plan', () => {
    expect(planIsPaid({ plan: { effective: 'pro' } })).toBe(true);
    expect(planIsPaid({ plan: { effective: 'free' } })).toBe(false);
    expect(planIsPaid(null)).toBe(false);
    expect(planIsPaid({})).toBe(false);
  });
});

const build = (storageProjectId: number, containerProjectId: number | null, modality = 'evermind'): EvermindBuild =>
  ({ id: storageProjectId, name: `b${storageProjectId}`, modality, storageProjectId, containerProjectId, containerName: null });

describe('Evermind builds', () => {
  it('lists the evermind and legacy llm builds only', async () => {
    const { request } = recorder({ '/api/ide-projects': [build(1, null), build(2, null, 'video'), build(3, null, 'llm')] });
    expect((await loadEvermindBuilds(request)).map((b) => b.storageProjectId)).toEqual([1, 3]);
  });

  it('keeps a valid choice, else the resolved Evermind, else one under the active project, else the first', () => {
    const builds = [build(1, null), build(2, 50), build(3, 60)];
    expect(preferredEvermindBuild(builds, { current: 3, resolvedProjectId: 2 })).toBe(3);
    expect(preferredEvermindBuild(builds, { current: 99, resolvedProjectId: 2 })).toBe(2);
    expect(preferredEvermindBuild(builds, { activeProjectId: 60 })).toBe(3);
    expect(preferredEvermindBuild(builds)).toBe(1);
    expect(preferredEvermindBuild([])).toBeNull();
  });
});
