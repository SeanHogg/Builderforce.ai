import { describe, expect, it, vi } from 'vitest';
import { APP_MANIFEST_SCHEMA_V1, parseManifest, validateManifest } from '@seanhogg/builderforce-webcontainers-core/manifest';
import { toAgentDeclaration } from '@builderforce/creation-canvas-contract';
import { APP_MANIFEST_TOOLS, createAppManifestTools, type ManifestFileStore } from './appManifestToolCatalog';
import { type BuiltinCtx, type BuiltinTool } from './builtinToolContext';

const ctx = {} as BuiltinCtx;
const tool = (name: string) => APP_MANIFEST_TOOLS.find((t) => t.tool === name)!;

const VALID = { version: 1, services: { web: { runtime: 'node', command: 'node server.js', port: 3000 } } };

describe('app manifest tools', () => {
  it('declares the two read-only tools the hint names, and add_agent as the one write', () => {
    expect(APP_MANIFEST_TOOLS.map((t) => t.tool)).toEqual(['app_manifest.schema', 'app_manifest.validate', 'app_manifest.add_agent']);
    expect(APP_MANIFEST_TOOLS.filter((t) => t.mutates).map((t) => t.tool)).toEqual(['app_manifest.add_agent']);
  });

  it('schema returns the shared v1 schema and a capability matrix for the target', async () => {
    const r = (await tool('app_manifest.schema').run(ctx, { target: 'cloudflare' })) as Record<string, unknown>;
    expect(r.ok).toBe(true);
    expect(r.target).toBe('cloudflare');
    expect(r.schema).toBe(APP_MANIFEST_SCHEMA_V1);
    expect(Object.keys(r.capabilities as object).length).toBeGreaterThan(0);
  });

  it('schema refuses an unknown target', async () => {
    const r = (await tool('app_manifest.schema').run(ctx, { target: 'mars' })) as Record<string, unknown>;
    expect(r.ok).toBe(false);
  });

  it('validate accepts a minimal valid manifest, as an object or a string', async () => {
    const parsed = parseManifest(JSON.stringify(VALID));
    expect(validateManifest(parsed.manifest!).some((i) => i.severity === 'error')).toBe(false);
    for (const content of [VALID, JSON.stringify(VALID)]) {
      const r = (await tool('app_manifest.validate').run(ctx, { content })) as Record<string, unknown>;
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
    }
  });

  it('validate rejects an invalid manifest with errors', async () => {
    const r = (await tool('app_manifest.validate').run(ctx, {
      content: { version: 1, services: { web: { port: 3000 } } },
    })) as { ok: boolean; errors: unknown[] };
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('validate reports unreadable JSON as an error, not a throw', async () => {
    const r = (await tool('app_manifest.validate').run(ctx, { content: '{nope' })) as { ok: boolean; errors: unknown[] };
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('app_manifest.add_agent', () => {
  const PROJECT_ID = 7;
  /** A manifest whose environment ceiling allows only `env.fs.read`. */
  const WITH_CEILING = { ...VALID, capabilities: { agents: { tools: ['env.fs.read'] } } };

  /** An in-memory manifest store: the one file, and every write it was asked for. */
  function memoryFiles(initial: unknown | null) {
    const writes: string[] = [];
    const files: ManifestFileStore = {
      read: async () => (initial === null ? null : { path: '.builderforce/builderforce.json', text: JSON.stringify(initial) }),
      write: async (_ctx, _projectId, text) => { writes.push(text); },
    };
    return { files, writes };
  }
  const ownerCtx = {
    tenantId: 1,
    projects: {
      getProject: vi.fn(async (id: number) => {
        if (id !== PROJECT_ID) throw new Error('not found');
        return { id };
      }),
    },
  } as unknown as BuiltinCtx;
  const addAgent = (files: ManifestFileStore) =>
    createAppManifestTools({ files }).find((t) => t.tool === 'app_manifest.add_agent')!;
  type Refusal = { ok: false; errors: Array<{ code: string; path: string }> };

  it('refuses a project outside the caller\'s workspace before reading anything', async () => {
    const store = memoryFiles(WITH_CEILING);
    const read = vi.spyOn(store.files, 'read');
    const r = (await addAgent(store.files).run(ownerCtx, { projectId: 99, id: 'triage', agent: { role: 'developer' } })) as { ok: boolean };
    expect(r.ok).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
  });

  it('refuses a model id with the typed agent-model-id issue and writes nothing', async () => {
    const store = memoryFiles(WITH_CEILING);
    for (const agent of [{ role: 'anthropic/claude-sonnet' }, { role: 'developer', model: 'gpt-4o' }]) {
      const r = (await addAgent(store.files).run(ownerCtx, { projectId: PROJECT_ID, id: 'triage', agent })) as Refusal;
      expect(r.ok).toBe(false);
      expect(r.errors.map((i) => i.code)).toContain('agent-model-id');
    }
    expect(store.writes).toEqual([]);
  });

  it('refuses a tool allowlist wider than the ceiling with policy-widening and writes nothing', async () => {
    const store = memoryFiles(WITH_CEILING);
    const r = (await addAgent(store.files).run(ownerCtx, {
      projectId: PROJECT_ID, id: 'triage', agent: { role: 'developer', tools: ['env.fs.read', 'env.fs.write'] },
    })) as Refusal;
    expect(r.ok).toBe(false);
    expect(r.errors).toContainEqual(expect.objectContaining({ code: 'policy-widening', path: 'agents.triage.tools', value: 'env.fs.write' }));
    expect(store.writes).toEqual([]);
  });

  it('refuses when the project has no manifest', async () => {
    const store = memoryFiles(null);
    const r = (await addAgent(store.files).run(ownerCtx, { projectId: PROJECT_ID, id: 'triage', agent: { role: 'developer' } })) as { ok: boolean };
    expect(r.ok).toBe(false);
    expect(store.writes).toEqual([]);
  });

  it('writes a valid declaration into the manifest, which then starts through runtime.agents.start', async () => {
    const store = memoryFiles(WITH_CEILING);
    const agent = toAgentDeclaration({
      id: 'triage',
      role: { kind: 'role', key: 'developer' },
      instructionsPath: 'agents/triage.md',
      tools: ['env.fs.read'],
      triggers: [{ kind: 'cron', cron: '0 3 * * *' }],
      budget: { steps: 20 },
    });
    const r = (await addAgent(store.files).run(ownerCtx, { projectId: PROJECT_ID, id: 'triage', agent })) as { ok: boolean; agentId: string };
    expect(r).toMatchObject({ ok: true, agentId: 'triage' });
    expect(store.writes).toHaveLength(1);
    const written = parseManifest(store.writes[0]!).manifest!;
    expect(written.agents?.triage).toEqual(agent);
    expect(validateManifest(written).filter((i) => i.severity === 'error')).toEqual([]);

    // `runtime.agents.start` is stubbed: it starts what the manifest declares, by id.
    const start: BuiltinTool = {
      tool: 'runtime.agents.start',
      mutates: true,
      description: 'stub',
      parameters: {},
      run: vi.fn(async (_ctx, a) => (written.agents?.[String(a.agentId)] ? { ok: true, runId: 'run-1' } : { ok: false })),
    };
    expect(await start.run(ownerCtx, { projectId: PROJECT_ID, agentId: r.agentId })).toEqual({ ok: true, runId: 'run-1' });
  });

  it('enables capabilities.agents for a manifest that has not, and accepts an empty tool list', async () => {
    const store = memoryFiles(VALID);
    const r = (await addAgent(store.files).run(ownerCtx, { projectId: PROJECT_ID, id: 'triage', agent: { role: 'developer', tools: [] } })) as { ok: boolean };
    expect(r.ok).toBe(true);
    const written = parseManifest(store.writes[0]!).manifest!;
    expect(written.capabilities).toEqual({ agents: {} });
  });
});
