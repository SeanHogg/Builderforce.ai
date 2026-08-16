/**
 * No `'use client'` here — every importer already declares the boundary. See
 * the note in `components/Pagination.tsx`.
 *
 * CatalogToolbar — search + extra filters + result count + view toggle, in one
 * bar, for every surface that browses a collection.
 *
 * The marketplace, the prompt library and the blog each browse a catalogue, and
 * each had arrived at a different subset of the same four controls: the
 * marketplace had search and a toggle but no count, /prompts had search, a sort
 * and a toggle, and /blog had none of them. A reader moving between the three
 * had to relearn the page every time.
 *
 * The toolbar owns the LAYOUT and the result count; what to search and how to
 * filter stay with the page. `children` is the slot for a surface's own extra
 * controls (a sort dropdown, a discipline select) so they sit inline with the
 * search box rather than in a second bar of their own.
 */

import { useTranslations } from 'next-intl';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';

export interface CatalogToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  /** Enter-to-search for surfaces that query the server rather than filter in place. */
  onSubmit?: () => void;
  /** Omit BOTH to render no view toggle (a surface whose grid has one layout). */
  view?: ViewMode;
  onView?: (mode: ViewMode) => void;
  /** Number of matching rows. Omit to hide the count. */
  resultCount?: number;
  /** Extra filter controls, rendered inline after the search box. */
  children?: React.ReactNode;
  /** Keep the bar pinned while the results scroll under it. */
  sticky?: boolean;
  className?: string;
}

export function CatalogToolbar({
  search,
  onSearch,
  searchPlaceholder,
  onSubmit,
  view,
  onView,
  resultCount,
  children,
  sticky,
  className,
}: CatalogToolbarProps) {
  const t = useTranslations('common');

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: sticky ? '12px 0 16px' : '0 0 16px',
        marginBottom: 16,
        borderBottom: '1px solid var(--border-subtle)',
        ...(sticky
          ? {
              position: 'sticky' as const,
              top: -16,
              zIndex: 15,
              background: 'color-mix(in srgb, var(--bg) 68%, transparent)',
              backdropFilter: 'blur(6px)',
            }
          : null),
      }}
    >
      <input
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit?.(); }}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        style={{
          // Grows into the bar on a wide viewport and takes the full width on a
          // narrow one, so the toolbar never needs a viewport query to lay out.
          flex: '1 1 220px',
          minWidth: 0,
          maxWidth: 380,
          padding: '9px 12px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          fontSize: 'var(--font-size-small)',
        }}
      />

      {children}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        {resultCount !== undefined && (
          <span
            // Announced when the count changes, so a filter press tells a screen
            // reader what it selected rather than silently reflowing the grid.
            aria-live="polite"
            style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
          >
            {t('resultCount', { n: resultCount })}
          </span>
        )}
        {view !== undefined && onView && <ViewToggle value={view} onChange={onView} />}
      </div>
    </div>
  );
}

export default CatalogToolbar;
