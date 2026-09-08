import { describe, expect, it } from 'vitest';
import type { BrainChat, CreationSessionSummary, WorkflowDefinitionSummary } from '@/lib/builderforceApi';
import type { IdeProject, Project, PublishedAgent } from '@/lib/types';
import { compareCreationLibraryEntries } from '@builderforce/creation-canvas-contract';
import { creationLibraryFacetCounts, creationLibraryItems, type CreationLibraryInput } from './creationLibrary';

function session(overrides: Partial<CreationSessionSummary> = {}): CreationSessionSummary {
  return {
    id: 's1',
    title: 'Launch plan',
    description: null,
    status: 'active',
    preview: { objectCount: 0, kinds: [], objects: [] },
    revision: 1,
    lastActivityAt: '2026-09-05T10:00:00.000Z',
    createdAt: '2026-09-01T10:00:00.000Z',
    role: 'owner',
    ...overrides,
  };
}

const workflow = { id: 'w1', name: 'Nurture sequence', runCount: 3 } as WorkflowDefinitionSummary;
const build = { id: 7, name: 'BuilderForce Mobile', modality: 'mobile', status: 'active', updatedAt: '2026-09-06T10:00:00.000Z' } as IdeProject;
const chat = { id: 88, title: 'Why is this 401?', updatedAt: '2026-09-04T10:00:00.000Z' } as BrainChat;
const project = { id: 4, name: 'pattysnob.com' } as Project;
const agent = { id: 'a1', name: 'Validator' } as PublishedAgent;

/** Describers and icons are the CALLER's (they hold the catalogs), so the tests supply
 *  identity-ish ones and assert on the mapping rather than on any wording. */
function input(overrides: Partial<CreationLibraryInput> = {}): CreationLibraryInput {
  return {
    sessions: [],
    builds: [],
    workflows: [],
    chats: [],
    projects: [],
    agents: [],
    includeRecords: true,
    describe: {
      build: (value) => `build:${value.status}`,
      workflow: (value) => `workflow:${value.runCount}`,
      chat: () => 'chat',
      project: () => 'project',
      agent: () => 'agent',
    },
    icons: { build: () => '▤', workflow: '⌘', chat: '●', project: '▦', agent: '✦' },
    ...overrides,
  };
}

describe('creationLibraryItems', () => {
  it('puts sessions and records in ONE list', () => {
    const items = creationLibraryItems(input({
      sessions: [session()],
      builds: [build], workflows: [workflow], chats: [chat], projects: [project], agents: [agent],
    }));

    expect(items).toHaveLength(6);
    expect(new Set(items.map((item) => item.facet)))
      .toEqual(new Set(['canvas', 'build', 'workflow', 'chat', 'project', 'agent']));
  });

  it('suppresses a record a session already holds a card for', () => {
    const items = creationLibraryItems(input({
      sessions: [session({ preview: { objectCount: 1, kinds: ['workflow'], objects: [
        { id: 'o1', kind: 'workflow', x: 0, y: 0, title: 'Nurture sequence', resourceType: 'workflow', resourceId: 'w1' },
      ] } })],
      workflows: [workflow],
    }));

    // One door into one room: the session's own tile.
    expect(items).toHaveLength(1);
    expect(items[0].facet).toBe('canvas');
  });

  it('does not let record-less cards collapse onto one another', () => {
    // Every card with no resource used to key as the string "null:null", so ONE such
    // card suppressed every record whose ref happened to be read the same way.
    const items = creationLibraryItems(input({
      sessions: [session({ preview: { objectCount: 2, kinds: ['note'], objects: [
        { id: 'o1', kind: 'note', x: 0, y: 0, title: 'A' },
        { id: 'o2', kind: 'note', x: 0, y: 0, title: 'B' },
      ] } })],
      workflows: [workflow],
      builds: [build],
    }));

    expect(items.map((item) => item.facet).sort()).toEqual(['build', 'canvas', 'workflow']);
  });

  it('orders by recency across the sources, with pinned first', () => {
    const items = creationLibraryItems(input({
      sessions: [
        session({ id: 'old', title: 'March board', lastActivityAt: '2026-03-01T10:00:00.000Z' }),
        session({ id: 'pinned', title: 'Pinned', lastActivityAt: '2026-01-01T10:00:00.000Z', pinned: true }),
      ],
      builds: [build],
    }));

    // The build (Sep 6) outranks the March canvas — the whole point of one list.
    expect(items.map((item) => item.title)).toEqual(['Pinned', 'BuilderForce Mobile', 'March board']);
  });

  it('leaves records out of the archived and folder-filtered readings', () => {
    const items = creationLibraryItems(input({
      sessions: [session()], workflows: [workflow], builds: [build],
      includeRecords: false,
    }));

    expect(items.map((item) => item.facet)).toEqual(['canvas']);
  });

  it('applies the query to records only — sessions arrive already searched', () => {
    const items = creationLibraryItems(input({
      // A server search matches object CONTENT, so a session it returned must survive
      // a client filter that only sees the title.
      sessions: [session({ title: 'Launch plan' })],
      workflows: [workflow],
      builds: [build],
      query: 'nurture',
    }));

    expect(items.map((item) => item.title)).toEqual(['Launch plan', 'Nurture sequence']);
  });

  it('gives a record a glyph and no board preview, and a session the reverse', () => {
    const items = creationLibraryItems(input({ sessions: [session()], workflows: [workflow] }));
    const canvas = items.find((item) => item.facet === 'canvas')!;
    const record = items.find((item) => item.facet === 'workflow')!;

    expect(canvas.icon).toBeNull();
    expect(canvas.managed).toBe(true);
    expect(canvas.sessionId).toBe('s1');

    expect(record.icon).toBe('⌘');
    expect(record.managed).toBe(false);
    expect(record.sessionId).toBeNull();
    expect(record.resource).toEqual({ type: 'workflow', id: 'w1' });
    expect(record.subtitle).toBe('workflow:3');
  });
});

describe('compareCreationLibraryEntries', () => {
  it('falls back to the title when neither item reports a timestamp', () => {
    const items = creationLibraryItems(input({ agents: [
      { id: 'b', name: 'Zed' } as PublishedAgent,
      { id: 'a', name: 'Ada' } as PublishedAgent,
    ] }));

    expect(items.map((item) => item.title)).toEqual(['Ada', 'Zed']);
    expect(compareCreationLibraryEntries(items[0], items[1])).toBeLessThan(0);
  });
});

describe('creationLibraryFacetCounts', () => {
  it('counts every facet, including the ones with nothing in them', () => {
    const counts = creationLibraryFacetCounts(creationLibraryItems(input({ sessions: [session()], workflows: [workflow] })));

    expect(counts).toEqual({ canvas: 1, build: 0, workflow: 1, chat: 0, project: 0, agent: 0 });
  });
});
