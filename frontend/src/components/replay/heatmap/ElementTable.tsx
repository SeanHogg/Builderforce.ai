/**
 * The route's elements (PRD 33 §2.1 "element tracking", §8 S4): clicks,
 * rage, dead and the change against the compare release, sortable with the
 * shared `useTableSort`. Columns are data (`ELEMENT_COLUMNS`); Δ appears only
 * when a compare release is chosen.
 *
 * Hovering (or focusing) a row highlights its zone on the page; opening a row
 * hands the selector to the caller, which opens the `issues` kind filtered to
 * visits that clicked it.
 */

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayElementRowDto } from '@builderforce/interaction-contract';
import { SortableTh, useTableSort } from '@/components/admin/adminShared';
import { useFormat } from '@/i18n/useFormat';
import type { Formatter } from '@/i18n/format';
import styles from './heatmap.module.css';

export type ElementColumnId = 'element' | 'clicks' | 'rage' | 'dead' | 'delta';

interface ElementColumn {
  id: ElementColumnId;
  /** Under `replay.heat.elements`. */
  labelKey: string;
  compareOnly?: boolean;
  numeric?: boolean;
  cell: (row: ReplayElementRowDto, fmt: Formatter, none: string) => ReactNode;
}

const signedPercent = (fmt: Formatter, value: number) => `${value > 0 ? '+' : ''}${fmt.percent(value)}`;

export const ELEMENT_COLUMNS: ReadonlyArray<ElementColumn> = [
  {
    id: 'element',
    labelKey: 'element',
    cell: (row) => (
      <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0, maxWidth: 320 }}>
        <span style={{ overflowWrap: 'anywhere' }}>{row.label || row.selector}</span>
        {row.label && <code style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{row.selector}</code>}
      </span>
    ),
  },
  { id: 'clicks', labelKey: 'clicks', numeric: true, cell: (row, fmt) => fmt.number(row.clicks) },
  { id: 'rage', labelKey: 'rage', numeric: true, cell: (row, fmt) => fmt.number(row.rage) },
  { id: 'dead', labelKey: 'dead', numeric: true, cell: (row, fmt) => fmt.number(row.dead) },
  {
    id: 'delta',
    labelKey: 'delta',
    numeric: true,
    compareOnly: true,
    cell: (row, fmt, none) => (row.delta == null ? none : signedPercent(fmt, row.delta)),
  },
];

export const ELEMENT_COMPARATORS: Record<ElementColumnId, (a: ReplayElementRowDto, b: ReplayElementRowDto) => number> = {
  element: (a, b) => (a.label || a.selector).localeCompare(b.label || b.selector),
  clicks: (a, b) => a.clicks - b.clicks,
  rage: (a, b) => a.rage - b.rage,
  dead: (a, b) => a.dead - b.dead,
  delta: (a, b) => (a.delta ?? Number.NEGATIVE_INFINITY) - (b.delta ?? Number.NEGATIVE_INFINITY),
};

export interface ElementTableProps {
  rows: readonly ReplayElementRowDto[];
  hasCompare: boolean;
  highlighted?: string | null;
  onHighlight?: (selector: string | null) => void;
  onOpen?: (row: ReplayElementRowDto) => void;
}

export function ElementTable({ rows, hasCompare, highlighted = null, onHighlight, onOpen }: ElementTableProps) {
  const t = useTranslations('replay.heat.elements');
  const fmt = useFormat();
  const { sort, toggle, sorted } = useTableSort<ElementColumnId, ReplayElementRowDto>(
    rows,
    ELEMENT_COMPARATORS,
    { key: 'clicks', direction: 'desc' },
  );
  const columns = ELEMENT_COLUMNS.filter((column) => !column.compareOnly || hasCompare);

  if (rows.length === 0) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>;

  return (
    <div className="table-wrap" style={{ overflowX: 'auto', minWidth: 0 }}>
      <table className="data-table" aria-label={t('title')}>
        <thead>
          <tr>
            {columns.map((column) => (
              <SortableTh
                key={column.id}
                columnKey={column.id}
                label={t(column.labelKey)}
                sort={sort}
                onSort={toggle}
                sortLabel={t('sortBy', { column: t(column.labelKey) })}
                style={column.numeric ? { textAlign: 'right' } : undefined}
              />
            ))}
            {onOpen && <th><span className="sr-only">{t('open')}</span></th>}
          </tr>
        </thead>
        <tbody onMouseLeave={() => onHighlight?.(null)}>
          {sorted.map((row) => (
            <tr
              key={row.selector}
              data-testid="heat-element-row"
              data-selector={row.selector}
              className={row.selector === highlighted ? styles.rowActive : undefined}
              onMouseEnter={() => onHighlight?.(row.selector)}
              onFocus={() => onHighlight?.(row.selector)}
              onClick={onOpen ? () => onOpen(row) : undefined}
              style={onOpen ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((column) => (
                <td key={column.id} style={column.numeric ? { textAlign: 'right', whiteSpace: 'nowrap' } : undefined}>
                  {column.cell(row, fmt, t('none'))}
                </td>
              ))}
              {onOpen && (
                <td>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ minHeight: 44 }}
                    aria-label={t('openAria', { element: row.label || row.selector })}
                    onClick={(event) => { event.stopPropagation(); onOpen(row); }}
                  >
                    {t('open')}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
