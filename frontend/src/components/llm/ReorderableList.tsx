'use client';

import { useTranslations } from 'next-intl';
import { useDragReorder } from '@/lib/useDragReorder';
import { buttonDanger, buttonPrimary } from './providerKeysStyles';

/**
 * THE ordered "what gets tried first" list — one implementation for every place a tenant
 * ranks something on the BYO settings surface.
 *
 * Three things are ranked there and they mean the same thing to the router: the ACCOUNT
 * precedence (which connected account leads), the MODEL order inside one OpenRouter
 * registration, and the MODEL order a connected provider was told to use. Each is a list
 * where position 1 wins, so each gets the same numbered rows, the same ↑/↓ affordance and
 * the same "leads" badge — a second hand-rolled reorder list is how they drift into looking
 * like unrelated features.
 *
 * `onRemove` is optional: precedence rows are removed by disconnecting the account, while a
 * model row can be dropped in place.
 *
 * Reordering is drag-first (shared {@link useDragReorder}) with the ↑/↓ buttons kept as the
 * keyboard- and touch-accessible path — native HTML5 drag fires on neither.
 */
export function ReorderableList({
  keys,
  labels,
  onReorder,
  onRemove,
}: {
  keys: string[];
  /** Display label per key; a key with no entry shows the key itself. */
  labels: Record<string, string>;
  onReorder: (next: string[]) => void;
  onRemove?: (key: string) => void;
}) {
  const t = useTranslations('providerKeys');
  const labelFor = (key: string) => labels[key] ?? key;
  const drag = useDragReorder(keys, onReorder);

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {keys.map((key, i) => (
        <li
          key={key}
          {...drag.dragHandleProps(key)}
          {...drag.dropTargetProps(key)}
          aria-label={t('precedence.rowLabel', { provider: labelFor(key), position: i + 1 })}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', flexWrap: 'wrap',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
            cursor: 'grab', opacity: drag.draggingKey === key ? 0.4 : 1,
            outline: drag.dropKey === key ? '2px dashed var(--coral-bright)' : 'none',
            outlineOffset: 2, transition: 'opacity 120ms ease',
          }}
        >
          {/* Affordance only — the whole row is the drag source, so the grip needs no
              handlers of its own (and must not steal the row's aria-label). */}
          <span aria-hidden="true" title={t('precedence.drag')} style={{ fontSize: 'var(--font-size-small)', lineHeight: 1, color: 'var(--text-muted)' }}>⠿</span>
          <span style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-muted)', minWidth: 18, textAlign: 'center' }}>{i + 1}</span>
          <span style={{ flex: 1, fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)', minWidth: 0, wordBreak: 'break-word' }}>
            {labelFor(key)}
          </span>
          {i === 0 && (
            <span style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, color: 'var(--success-text)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {t('precedence.leads')}
            </span>
          )}
          <button
            type="button"
            onClick={() => drag.nudge(key, -1)}
            disabled={i === 0}
            aria-label={t('precedence.moveUp', { provider: labelFor(key) })}
            style={{ ...buttonPrimary, padding: '2px 9px', opacity: i === 0 ? 0.4 : 1 }}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => drag.nudge(key, 1)}
            disabled={i === keys.length - 1}
            aria-label={t('precedence.moveDown', { provider: labelFor(key) })}
            style={{ ...buttonPrimary, padding: '2px 9px', opacity: i === keys.length - 1 ? 0.4 : 1 }}
          >
            ↓
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(key)}
              aria-label={t('openRouter.removeModel', { model: labelFor(key) })}
              style={{ ...buttonDanger, padding: '2px 9px' }}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
