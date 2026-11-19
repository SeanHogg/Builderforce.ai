import type { ReactNode } from 'react';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import type { CreationLibraryItem } from '@/domains/canvas/domain/creationLibrary';

/**
 * The Create library as a `CollectionDescriptor` — the ONE shape every list in the
 * app renders through (PRD 47).
 *
 * The id is the SESSION id when there is one, because that is what the bulk
 * endpoint (`creation-session`) acts on. A record that has never been opened has no
 * session, so its id falls back to its list key; the bulk endpoint reports such an id
 * as `not_found` (skipped) rather than acting on it, which is the honest answer.
 *
 * The library arrives already ordered (pinned first, then recency) from the shared
 * core, so the default sort is `library` — a column with no comparator, which keeps
 * the input order. The sortable columns re-sort client-side over what is loaded.
 */
export interface CreationLibraryDescriptorParts {
  /** Already-translated column headers. */
  headers: { title: string; kind: string; folder: string; updated: string };
  /** The tile body — selection checkbox is added by the Collection around it. */
  renderCard: (item: CreationLibraryItem) => ReactNode;
  /** Opens the item (title cell in List mode). */
  onOpen: (item: CreationLibraryItem) => void;
  /** Already-translated copy for the item's kind facet. */
  facetLabel: (item: CreationLibraryItem) => string;
  /** Formats a date. */
  formatDate: (iso: string) => string;
}

const time = (item: CreationLibraryItem): number => (item.lastActivityAt ? Date.parse(item.lastActivityAt) || 0 : 0);

export function creationLibraryRowId(item: CreationLibraryItem): string {
  return item.sessionId ?? item.key;
}

export function creationLibraryDescriptor(parts: CreationLibraryDescriptorParts): CollectionDescriptor<CreationLibraryItem> {
  return {
    entity: 'creation-session',
    surfaceKey: 'create.library',
    rowId: creationLibraryRowId,
    label: (item) => item.title,
    defaultView: 'card',
    defaultSort: { key: 'library', dir: 'asc' },
    emptyKey: 'empty',
    columns: [
      {
        key: 'title',
        header: parts.headers.title,
        sortKey: 'title',
        compare: (a, b) => a.title.localeCompare(b.title),
        cell: (item) => (
          <button
            type="button"
            onClick={() => parts.onOpen(item)}
            style={{ background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', textAlign: 'start' }}
          >
            {item.pinned ? '📌 ' : ''}{item.title}
          </button>
        ),
      },
      {
        key: 'kind',
        header: parts.headers.kind,
        sortKey: 'kind',
        compare: (a, b) => a.facet.localeCompare(b.facet),
        cell: (item) => parts.facetLabel(item),
      },
      {
        key: 'folder',
        header: parts.headers.folder,
        sortKey: 'folder',
        compare: (a, b) => (a.folderName ?? '').localeCompare(b.folderName ?? ''),
        cell: (item) => item.folderName ?? '—',
      },
      {
        key: 'updated',
        header: parts.headers.updated,
        sortKey: 'updated',
        compare: (a, b) => time(a) - time(b),
        align: 'end',
        cell: (item) => (item.lastActivityAt ? parts.formatDate(item.lastActivityAt) : '—'),
      },
    ],
    card: parts.renderCard,
  };
}
