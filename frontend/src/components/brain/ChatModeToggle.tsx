'use client';

/**
 * Chat | Work — the mode switch for a conversation.
 *
 * ONE control, used by every surface that has a composer: the Brain panel (page and
 * docked drawer) and the Creation Canvas. It is deliberately a segmented radio group
 * rather than a `<select>`: there are exactly two values, both matter, and the user
 * needs to see which one is armed WITHOUT opening anything — flipping to Work grants
 * the conversation authority to open and dispatch real work, which is not a state to
 * discover by accident.
 *
 * Self-describing: the component owns its own labels, tooltips and a11y wiring, so a
 * host passes only the value and the setter.
 *
 * Theme: every colour is a token with a literal fallback, so it reads in light AND
 * dark. Responsive: `compact` drops the text labels to glyphs for a narrow composer
 * toolbar; both variants keep a tap-friendly 32px control height via --chat-ctl-size.
 */

import { useTranslations } from 'next-intl';
import { CHAT_MODES, CHAT_MODE_ICON, type ChatMode } from '@/lib/brain';

export interface ChatModeToggleProps {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
  /**
   * `compact` — glyph-only pills for the composer toolbar.
   * `full`    — glyph + label, for the empty state where there is room to explain.
   */
  layout?: 'compact' | 'full';
  /** Disable while a turn is streaming (switching mid-run would not apply to it). */
  disabled?: boolean;
}

export function ChatModeToggle({ value, onChange, layout = 'compact', disabled }: ChatModeToggleProps) {
  const t = useTranslations('brain.modes');
  const full = layout === 'full';

  return (
    <div
      role="radiogroup"
      aria-label={t('pickerAria')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        flexShrink: 0,
        padding: 2,
        borderRadius: 9999,
        border: '1px solid var(--border-subtle, rgba(128,128,128,0.3))',
        background: 'var(--bg-base, transparent)',
      }}
    >
      {CHAT_MODES.map((mode) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={t(`${mode}.hint`)}
            onClick={() => { if (!active) onChange(mode); }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 'var(--chat-ctl-size, 32px)',
              padding: full ? '0 16px' : '0 11px',
              borderRadius: 9999,
              border: 'none',
              fontSize: full ? 13 : 12,
              fontWeight: active ? 600 : 500,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              background: active ? 'var(--bg-elevated, rgba(128,128,128,0.16))' : 'transparent',
              color: active ? 'var(--text-primary, #111)' : 'var(--text-muted, #6b7280)',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
            }}
          >
            <span aria-hidden>{CHAT_MODE_ICON[mode]}</span>
            {/* The label is always in the accessible name; `compact` hides it visually
                only, so a narrow toolbar loses the text without losing the semantics. */}
            <span className={full ? undefined : 'sr-only'}>{t(`${mode}.label`)}</span>
          </button>
        );
      })}
    </div>
  );
}
