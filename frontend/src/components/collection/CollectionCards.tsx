import { useTranslations } from 'next-intl';
import type { CollectionDescriptor } from './descriptor';
import type { CollectionSelection } from './useCollectionSelection';

/**
 * CollectionCards — the Card-mode body (PRD 47 §3.1). An auto-fill `minmax()`
 * grid wraps each descriptor `card(row)` with a per-card selection checkbox;
 * a header "select page" checkbox selects/clears the current page and shows
 * `indeterminate` when only part of it is selected. Card mode is also where
 * Board's selection lands (the card checkbox), so the checkbox is the one
 * control every multi-select layout shares.
 */
export interface CollectionCardsProps<Row> {
  descriptor: CollectionDescriptor<Row>;
  rows: Row[];
  selection: CollectionSelection | null;
}

const checkboxStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  accentColor: 'var(--coral-bright)',
  cursor: 'pointer',
};

const cardChrome: React.CSSProperties = {
  position: 'relative',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
};

export function CollectionCards<Row>({ descriptor, rows, selection }: CollectionCardsProps<Row>) {
  const t = useTranslations('common.collection');
  const pageIds = rows.map((r) => descriptor.rowId(r));
  const state = selection?.pageState(pageIds) ?? 'none';
  const headerChecked = state === 'all';
  const indeterminate = state === 'some';

  return (
    <div>
      {selection && rows.length > 0 && (
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 40,
            fontSize: 'var(--font-size-small)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            marginBottom: 8,
          }}
        >
          <input
            type="checkbox"
            aria-label={t('selectPage')}
            checked={headerChecked}
            ref={(el) => {
              if (el) el.indeterminate = indeterminate;
            }}
            onChange={() => selection.togglePage(pageIds)}
            style={checkboxStyle}
          />
          {t('selectPage')}
        </label>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 16,
        }}
      >
        {rows.map((row) => {
          const id = descriptor.rowId(row);
          return (
            <div key={id} style={cardChrome}>
              {selection && (
                <input
                  type="checkbox"
                  aria-label={t('selectRow', { label: descriptor.label(row) })}
                  checked={selection.isSelected(id)}
                  onChange={() => selection.toggle(id)}
                  style={{ ...checkboxStyle, position: 'absolute', top: 8, left: 8, zIndex: 1 }}
                />
              )}
              {descriptor.card(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
