import { describe, expect, it, vi } from 'vitest';
import type { CreationLibraryItem } from '@/domains/canvas/domain/creationLibrary';
import { BULK_CAPABILITIES } from '@/components/collection/descriptor';
import { creationLibraryDescriptor, creationLibraryRowId } from './creationLibraryDescriptor';

const base = {
  key: 'session-s1', facet: 'canvas', sessionId: 's1', resource: null, title: 'Launch plan',
  kinds: [], objects: [], objectCount: 0, collaboratorCount: 1,
  lastActivityAt: '2026-09-05T10:00:00.000Z', pinned: false, unread: false,
  folderId: null, folderName: 'Client work', projectIds: [], icon: null, subtitle: '',
  managed: true, focusObjectId: null,
} satisfies CreationLibraryItem;

const record = { ...base, key: 'workflow-w1', facet: 'workflow', sessionId: null, resource: { type: 'workflow', id: 'w1' }, title: 'Nurture', managed: false, lastActivityAt: null, folderName: null } satisfies CreationLibraryItem;

const descriptor = creationLibraryDescriptor({
  headers: { title: 'Name', kind: 'Kind', folder: 'Folder', updated: 'Updated' },
  renderCard: () => null,
  onOpen: vi.fn(),
  facetLabel: (item) => item.facet,
  formatDate: (iso) => iso,
});

describe('creationLibraryDescriptor', () => {
  it('is the creation-session entity with a bulk-capable matrix row', () => {
    expect(descriptor.entity).toBe('creation-session');
    expect(descriptor.surfaceKey).toBe('create.library');
    expect(BULK_CAPABILITIES['creation-session'].hasArchive).toBe(true);
  });

  it('identifies a row by its session id, falling back to the list key for a record', () => {
    expect(creationLibraryRowId(base)).toBe('s1');
    expect(creationLibraryRowId(record)).toBe('workflow-w1');
  });

  it('sorts locally by title, folder and updated', () => {
    const byKey = (key: string) => descriptor.columns.find((c) => c.key === key)!.compare!;
    expect(byKey('title')(base, record)).toBeLessThan(0); // Launch plan < Nurture
    expect(byKey('folder')(base, record)).toBeGreaterThan(0); // 'Client work' > ''
    expect(byKey('updated')(base, record)).toBeGreaterThan(0); // dated > never
  });
});
