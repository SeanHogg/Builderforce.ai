'use client';

/**
 * "What do you want done?" — the Work-mode starting points.
 *
 * Shown only in WORK mode, and only before the conversation has started: once there
 * is a thread, the thread is the starting point. Picking a tile seeds the composer
 * with a COMPLETE brief (see `lib/brain/chatModes.ts` for why the briefs are long)
 * which the user then edits — the host focuses the composer with the caret at the end
 * so it reads as a sentence to finish, not a message to send.
 *
 * Self-gating on `mode`, per the shared-component rule: a host renders it
 * unconditionally and this decides whether it belongs on screen.
 *
 * Theme tokens throughout (light + dark); the grid is `auto-fit`/`minmax` so it
 * reflows from three columns to one without overflowing a 360px viewport.
 */

import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { workOptions, type ChatMode, type WorkOptionId } from '@/lib/brain';

export interface WorkOptionsPickerProps {
  /** The conversation's mode. Anything but `work` renders nothing. */
  mode: ChatMode;
  /** Seed the composer with this option's brief. */
  onPick: (id: WorkOptionId, brief: string) => void;
  disabled?: boolean;
}

export function WorkOptionsPicker({ mode, onPick, disabled }: WorkOptionsPickerProps) {
  const t = useTranslations('brain.workOptions');
  if (mode !== 'work') return null;
  const options = workOptions();

  return (
    <div style={{ width: '100%', maxWidth: 720, padding: '0 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 10 }}>
        {t('tilesHint')}
      </div>
      <div
        role="group"
        aria-label={t('pickerAria')}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(option.id, t(`${option.id}.brief`))}
            title={t(`${option.id}.hint`)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
              minHeight: 56,
              padding: '11px 12px',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle, rgba(128,128,128,0.3))',
              background: 'var(--bg-elevated, rgba(128,128,128,0.06))',
              color: 'var(--text-primary)',
              cursor: disabled ? 'default' : 'pointer',
              textAlign: 'left',
            }}
          >
            <span aria-hidden style={{ flexShrink: 0 }}><Icon source={option.icon} size={20} /></span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{t(`${option.id}.label`)}</span>
              <span style={{ display: 'block', fontSize: 11, marginTop: 2, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                {t(`${option.id}.hint`)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
