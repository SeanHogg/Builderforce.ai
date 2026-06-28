'use client';

import { useTranslations } from 'next-intl';
import { useOptionalPins } from '@/lib/widgets/PinsProvider';

/**
 * The pin / unpin control that sits in every widget card's top-right corner (the
 * box drawn in the screenshot). Pinning a widget adds it to the user's personal
 * /insights home dashboard; unpinning removes it. Self-contained — it reads pin
 * state from {@link usePins} and toggles optimistically.
 */
export function PinButton({ widgetKey }: { widgetKey: string }) {
  const t = useTranslations('widgets');
  const pins = useOptionalPins();
  if (!pins) return null;
  const pinned = pins.isPinned(widgetKey);
  const label = pinned ? t('unpin') : t('pin');

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); pins.toggle(widgetKey); }}
      title={label}
      aria-label={label}
      aria-pressed={pinned}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, flexShrink: 0,
        border: `1px solid ${pinned ? 'var(--coral-bright, #f4726e)' : 'var(--border-subtle)'}`,
        borderRadius: 7, cursor: 'pointer',
        background: pinned ? 'var(--coral-bright, #f4726e)' : 'transparent',
        color: pinned ? '#fff' : 'var(--text-muted)',
        transition: 'all 0.15s ease',
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden style={{ width: 15, height: 15, fill: pinned ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.8 }}>
        {/* a push-pin glyph */}
        <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z" strokeLinejoin="round" />
        <line x1="12" y1="14" x2="12" y2="21" />
      </svg>
    </button>
  );
}
