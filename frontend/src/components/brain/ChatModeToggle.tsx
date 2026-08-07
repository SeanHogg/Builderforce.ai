'use client';

/**
 * Chat | Work — the mode choice on a conversation's EMPTY STATE.
 *
 * A segmented radio group rather than a `<select>`: there are exactly two values, both
 * matter, and choosing Work grants the conversation authority to open and dispatch real
 * work — not a state to discover by accident. This is where the choice is made BEFORE
 * there is a conversation to make it in; once one exists, the composer's `/` menu owns
 * it (see PromptOptionsMenu), which is why there is no compact variant here any more:
 * a second, glyph-only copy of this control in the action row was one of eight
 * unlabelled circles a phone could not fit.
 *
 * Self-describing: the component owns its own labels, tooltips and a11y wiring, so a
 * host passes only the value and the setter.
 *
 * Theme: every colour is a token with a literal fallback, so it reads in light AND
 * dark. Responsive: the pills wrap and keep a tap-friendly 32px height via --chat-ctl-size.
 */

import { useTranslations } from 'next-intl';
import { CHAT_MODES, CHAT_MODE_ICON, type ChatMode } from '@/lib/brain';

export interface ChatModeToggleProps {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
}

export function ChatModeToggle({ value, onChange }: ChatModeToggleProps) {
  const t = useTranslations('brain.modes');

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
            title={t(`${mode}.hint`)}
            onClick={() => { if (!active) onChange(mode); }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 'var(--chat-ctl-size, 32px)',
              padding: '0 16px',
              borderRadius: 9999,
              border: 'none',
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              background: active ? 'var(--bg-elevated, rgba(128,128,128,0.16))' : 'transparent',
              color: active ? 'var(--text-primary, #111)' : 'var(--text-muted, #6b7280)',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
            }}
          >
            <span aria-hidden>{CHAT_MODE_ICON[mode]}</span>
            <span>{t(`${mode}.label`)}</span>
          </button>
        );
      })}
    </div>
  );
}
