import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMemoryLocalFirstStore } from './store.js';
import {
  LOCAL_DOMAIN_TOOLS,
  NOTE_TEXT_REQUIRED,
  PLATFORM_DENIED_USE_LOCAL_TOOL,
  PLATFORM_TOOL_REQUIRED,
  executeDomainTool,
  isLocalDomainTool,
  localToolFor,
  refusePlatformWhenDenied,
  type ExecuteDomainToolInput,
  type LocalDomainTool,
  type PlatformToolCaller,
} from './localTools.js';

const DEVICE = 'device-1';
const AT = '2026-10-19T00:00:00.000Z';

const TOOLS: readonly LocalDomainTool[] = ['project-create', 'ticket-create', 'memory-recall'];

describe('local domain tools', () => {
  it('lists only the supported domain tools', () => {
    expect([...LOCAL_DOMAIN_TOOLS]).toEqual([...TOOLS]);
    for (const capability of TOOLS) expect(isLocalDomainTool(capability)).toBe(true);
    expect(isLocalDomainTool('cloud-mcp-tool')).toBe(false);
    expect(isLocalDomainTool('')).toBe(false);
  });

  it('returns the local tool when policy denies the capability', () => {
    for (const capability of TOOLS) {
      const resolved = localToolFor(capability, false);
      expect(resolved).toEqual({ kind: 'local', tool: capability });
      expect(resolved.kind).not.toBe('platform');
      expect(Object.isFrozen(resolved)).toBe(true);
    }
  });

  it('returns the platform tool only when policy allows it', () => {
    for (const capability of TOOLS) {
      expect(localToolFor(capability, true)).toEqual({ kind: 'platform', tool: capability });
    }
  });

  it('does not select a platform tool for a non-allow', () => {
    for (const capability of TOOLS) {
      expect(localToolFor(capability, false).kind).toBe('local');
    }
  });

  it('throws platform_denied_use_local_tool when a platform call is denied', () => {
    for (const capability of TOOLS) {
      expect(() => refusePlatformWhenDenied(capability, false)).toThrow(PLATFORM_DENIED_USE_LOCAL_TOOL);
      try {
        refusePlatformWhenDenied(capability, false);
        expect.unreachable('denied policy must throw');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(PLATFORM_DENIED_USE_LOCAL_TOOL);
        expect((error as { code?: string }).code).toBe(PLATFORM_DENIED_USE_LOCAL_TOOL);
      }
    }
  });

  it('does not throw when policy allows the platform tool', () => {
    for (const capability of TOOLS) {
      expect(() => refusePlatformWhenDenied(capability, true)).not.toThrow();
      expect(refusePlatformWhenDenied(capability, true)).toBeUndefined();
    }
  });

  it('refuses an unknown capability instead of selecting a platform tool', () => {
    expect(() => localToolFor('cloud-mcp-tool' as LocalDomainTool, true)).toThrow('unknown_domain_tool');
    expect(() => refusePlatformWhenDenied('cloud-mcp-tool' as LocalDomainTool, true)).toThrow(
      'unknown_domain_tool',
    );
  });

  it('does not import a network client', () => {
    const source = readFileSync(new URL('./localTools.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/import\s+[^;]*\bfetch\b/);
    expect(source).not.toMatch(/from\s+['"]node:(https?|http|net)['"]/);
  });
});

function deniedSpies(): {
  fetchCalls: unknown[];
  platformCalls: string[];
  platformTool: PlatformToolCaller;
  restore: () => void;
} {
  const fetchCalls: unknown[] = [];
  const platformCalls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown) => {
    fetchCalls.push(input);
    throw new Error('network_denied');
  }) as typeof fetch;
  const platformTool: PlatformToolCaller = async (tool) => {
    platformCalls.push(tool);
    throw new Error('platform_tool_called');
  };
  return {
    fetchCalls,
    platformCalls,
    platformTool,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe('denied domain tools write the local store', () => {
  it('creates a project locally and does not fetch or call the platform', async () => {
    const store = createMemoryLocalFirstStore();
    const spies = deniedSpies();
    try {
      const saved = await executeDomainTool({
        capability: 'project-create',
        policyAllows: false,
        store,
        deviceId: DEVICE,
        id: 'project-1',
        name: 'Offline board',
        key: 'OFF',
        occurredAt: AT,
        platformTool: spies.platformTool,
      });
      expect(saved.kind).toBe('local');
      if (saved.kind !== 'local') return;
      expect(saved.tool).toBe('project-create');
      expect(saved.id).toBe('project-1');
      expect(saved.entityType).toBe('project');
      expect(saved.record.payload).toEqual({ name: 'Offline board', key: 'OFF' });
    } finally {
      spies.restore();
    }
    expect(spies.fetchCalls).toEqual([]);
    expect(spies.platformCalls).toEqual([]);
    const snapshot = await store.export();
    expect(snapshot.records).toEqual([
      expect.objectContaining({
        id: 'project-1',
        entityType: 'project',
        payload: { name: 'Offline board', key: 'OFF' },
      }),
    ]);
    expect(snapshot.events).toEqual([
      expect.objectContaining({
        clientEntityId: 'project-1',
        entityType: 'project',
        operation: 'create',
        occurredAt: AT,
      }),
    ]);
  });

  it('creates a ticket locally and does not fetch or call the platform', async () => {
    const store = createMemoryLocalFirstStore();
    const spies = deniedSpies();
    try {
      await executeDomainTool({
        capability: 'project-create',
        policyAllows: false,
        store,
        deviceId: DEVICE,
        id: 'project-1',
        name: 'Offline board',
        occurredAt: AT,
        platformTool: spies.platformTool,
      });
      const saved = await executeDomainTool({
        capability: 'ticket-create',
        policyAllows: false,
        store,
        deviceId: DEVICE,
        id: 'ticket-1',
        projectId: 'project-1',
        title: 'Ship local create',
        description: 'No platform call.',
        occurredAt: '2026-10-19T00:01:00.000Z',
        platformTool: spies.platformTool,
      });
      expect(saved.kind).toBe('local');
      if (saved.kind !== 'local') return;
      expect(saved.tool).toBe('ticket-create');
      expect(saved.record.payload).toEqual({
        projectId: 'project-1',
        title: 'Ship local create',
        description: 'No platform call.',
        status: 'backlog',
      });
    } finally {
      spies.restore();
    }
    expect(spies.fetchCalls).toEqual([]);
    expect(spies.platformCalls).toEqual([]);
    const snapshot = await store.export();
    // A dependency on a pending event is stored as that event's wire id.
    const projectEvent = snapshot.events.find((event) => event.clientEntityId === 'project-1');
    expect(snapshot.events.find((event) => event.clientEntityId === 'ticket-1')).toEqual(
      expect.objectContaining({
        entityType: 'ticket',
        operation: 'create',
        dependsOn: [projectEvent?.eventId],
      }),
    );
  });

  it('records a note locally and does not fetch or call the platform', async () => {
    const store = createMemoryLocalFirstStore();
    const spies = deniedSpies();
    try {
      const saved = await executeDomainTool({
        capability: 'memory-recall',
        policyAllows: false,
        store,
        deviceId: DEVICE,
        id: 'note-1',
        note: 'Ship offline tools',
        occurredAt: AT,
        platformTool: spies.platformTool,
      });
      expect(saved.kind).toBe('local');
      if (saved.kind !== 'local') return;
      expect(saved.tool).toBe('memory-recall');
      expect(saved.entityType).toBe('memory-fact');
      expect(saved.record.payload).toEqual(expect.objectContaining({
        key: 'note',
        statement: 'Ship offline tools',
      }));
    } finally {
      spies.restore();
    }
    expect(spies.fetchCalls).toEqual([]);
    expect(spies.platformCalls).toEqual([]);
    const snapshot = await store.export();
    expect(snapshot.records).toEqual([
      expect.objectContaining({
        id: 'note-1',
        entityType: 'memory-fact',
      }),
    ]);
    expect(snapshot.events).toEqual([
      expect.objectContaining({
        clientEntityId: 'note-1',
        entityType: 'memory-fact',
        operation: 'create',
        occurredAt: AT,
      }),
    ]);
  });

  it('does not fall back to the platform when a denied ticket has no project', async () => {
    const store = createMemoryLocalFirstStore();
    const spies = deniedSpies();
    const before = await store.export();
    try {
      await expect(executeDomainTool({
        capability: 'ticket-create',
        policyAllows: false,
        store,
        deviceId: DEVICE,
        id: 'ticket-missing',
        projectId: 'missing-project',
        title: 'Should not land',
        platformTool: spies.platformTool,
      })).rejects.toThrow('project_not_found');
    } finally {
      spies.restore();
    }
    expect(spies.fetchCalls).toEqual([]);
    expect(spies.platformCalls).toEqual([]);
    expect(await store.export()).toEqual(before);
  });

  it('refuses an empty note without fetching or calling the platform', async () => {
    const store = createMemoryLocalFirstStore();
    const spies = deniedSpies();
    const before = await store.export();
    try {
      await expect(executeDomainTool({
        capability: 'memory-recall',
        policyAllows: false,
        store,
        deviceId: DEVICE,
        note: '   ',
        platformTool: spies.platformTool,
      })).rejects.toThrow(NOTE_TEXT_REQUIRED);
    } finally {
      spies.restore();
    }
    expect(spies.fetchCalls).toEqual([]);
    expect(spies.platformCalls).toEqual([]);
    expect(await store.export()).toEqual(before);
  });

  it('calls the platform tool only when policy allows, and does not write locally', async () => {
    const store = createMemoryLocalFirstStore();
    const spies = deniedSpies();
    const platformCalls: Array<{ tool: string; args: Readonly<Record<string, unknown>> }> = [];
    try {
      const saved = await executeDomainTool({
        capability: 'project-create',
        policyAllows: true,
        store,
        deviceId: DEVICE,
        name: 'Remote board',
        platformTool: async (tool, args) => {
          platformCalls.push({ tool, args });
          return { serverId: '99' };
        },
      });
      expect(saved).toEqual({
        kind: 'platform',
        tool: 'project-create',
        result: { serverId: '99' },
      });
    } finally {
      spies.restore();
    }
    expect(spies.fetchCalls).toEqual([]);
    expect(platformCalls).toEqual([
      { tool: 'project-create', args: { name: 'Remote board', deviceId: DEVICE } },
    ]);
    const snapshot = await store.export();
    expect(snapshot.records).toEqual([]);
    expect(snapshot.events).toEqual([]);
  });

  it('does not write or call the platform when an allowed call has no platform tool', async () => {
    const store = createMemoryLocalFirstStore();
    await expect(executeDomainTool({
      capability: 'project-create',
      policyAllows: true,
      store,
      deviceId: DEVICE,
      name: 'Remote board',
    })).rejects.toThrow(PLATFORM_TOOL_REQUIRED);
    const snapshot = await store.export();
    expect(snapshot.records).toEqual([]);
    expect(snapshot.events).toEqual([]);
  });

  it('refuses an unknown capability without fetching or calling the platform', async () => {
    const store = createMemoryLocalFirstStore();
    const spies = deniedSpies();
    try {
      await expect(executeDomainTool({
        capability: 'cloud-mcp-tool',
        policyAllows: true,
        store,
        deviceId: DEVICE,
        name: 'Nope',
        platformTool: spies.platformTool,
      } as ExecuteDomainToolInput)).rejects.toThrow('unknown_domain_tool');
    } finally {
      spies.restore();
    }
    expect(spies.fetchCalls).toEqual([]);
    expect(spies.platformCalls).toEqual([]);
    expect((await store.export()).records).toEqual([]);
  });
});
