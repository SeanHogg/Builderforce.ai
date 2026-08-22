'use client';

import { ReactNode, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * The scaffold every per-tenant superadmin override wears: a bordered card, a
 * title with the current effective value beside it, a row of mode controls, one
 * Save button, and the error the save failed with.
 *
 * It exists because the second override editor copied the first. The daily token
 * cap and the premium-routing flag are different CONTROLS — three radios and a
 * number input against two radios — but identical everywhere else: the same
 * chrome, the same `saving`/`error` state machine, the same stop-propagation on
 * a button that lives inside a clickable row. The premium editor's own comment
 * said "Mirrors TenantTokenLimitOverrideEditor", which is the copy admitting to
 * itself; a third override would have mirrored whichever one its author opened.
 *
 * The card owns the SAVE, not just the frame. `onSave` may throw — a validation
 * failure and a rejected request arrive the same way and are shown the same way —
 * so a caller never re-implements the try/finally, and `saving` reaches the
 * controls as an argument rather than as state each caller keeps for itself.
 *
 * What a caller owns is only its own controls and its own meaning of dirty.
 */
interface Props {
  /** Heading, already localised. */
  title: string;
  /** The current effective value, already localised — shown beside the title. */
  current: string;
  /** The mode controls. Given `saving` so each input disables itself. */
  children: (saving: boolean) => ReactNode;
  /** Persist. Throw an `Error` to show its message; anything else shows `fallbackError`. */
  onSave: () => Promise<void>;
  /** Shown when `onSave` throws something that is not an `Error`. */
  fallbackError: string;
  /** When given, Save is disabled and dimmed until there is something to save. */
  dirty?: boolean;
}

export function TenantOverrideCard({ title, current, children, onSave, fallbackError, dirty }: Props) {
  const t = useTranslations('admin');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `undefined` means the caller does not track dirtiness — its Save is always live.
  const enabled = dirty ?? true;

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await onSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallbackError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        padding: 12,
        background: 'var(--bg-base)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        marginBottom: 12,
      }}
    >
      {/*
        Type roles, not sizes (`check:design-scale`): the heading is a card title
        and everything else is `small`. The editors this replaced each typed
        `fontSize: 13` and `fontSize: 12` inline, which is how one "card title"
        becomes three — and holding the scale here means a caller cannot restate it.
      */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <div className="ui-text-card-title">{title}</div>
        <div className="ui-text-small" style={{ color: 'var(--text-muted)' }}>
          {current}
        </div>
      </div>

      <div className="ui-text-small" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
        {children(saving)}

        <button
          type="button"
          className="btn-primary ui-text-small"
          style={{ marginLeft: 'auto', padding: '4px 12px', opacity: enabled ? 1 : 0.5 }}
          onClick={(e) => {
            // The card is rendered inside a clickable tenant row.
            e.stopPropagation();
            void save();
          }}
          disabled={saving || !enabled}
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>

      {error && (
        <div className="ui-text-small" style={{ marginTop: 8, color: 'var(--coral-bright)' }}>
          {error}
        </div>
      )}
    </div>
  );
}
