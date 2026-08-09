'use client';

/**
 * CopyButton — the ONE copy-to-clipboard control.
 *
 * The idle → copied → idle feedback dance (and its failure case) was inlined at a dozen
 * call sites, each with its own timeout, its own label and its own idea of what happens
 * when the clipboard API is unavailable. This owns all of it, so a copy affordance
 * behaves identically everywhere and a caller only supplies the payload.
 *
 * `getText` is a callback rather than a string so an expensive report is built ONLY on
 * click — a diagnostics dump that serialises a whole payload should not be recomputed on
 * every parent render.
 *
 * Clipboard access requires a secure context and can be denied by permission policy, so
 * failure is a real state, surfaced rather than swallowed.
 */
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

export interface CopyButtonProps {
  /** Built on click. May be async so a caller can fetch before copying. */
  getText: () => string | Promise<string>;
  /** Idle label. Defaults to the shared `common.copy` string. */
  label?: string;
  /** Accessible description when the visible label is an icon only. */
  ariaLabel?: string;
  /** Render compactly (icon + short label) for dense headers. */
  compact?: boolean;
  /** How long the confirmation shows, ms. */
  feedbackMs?: number;
}

export function CopyButton({
  getText, label, ariaLabel, compact = false, feedbackMs = 2000,
}: CopyButtonProps) {
  const t = useTranslations('common');
  // The write, the feedback state and the unmount-safe reset all live in the shared hook.
  const { state, copy } = useCopyToClipboard(feedbackMs);
  const onCopy = useCallback(() => { void copy(getText); }, [copy, getText]);

  const text = state === 'copied' ? t('copied') : state === 'error' ? t('copyFailed') : (label ?? t('copy'));
  const tone = state === 'copied' ? 'var(--success)' : state === 'error' ? 'var(--error-text)' : 'var(--text-secondary)';

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={ariaLabel ?? text}
      title={ariaLabel ?? text}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 'var(--font-size-small)', fontWeight: 600,
        // 32px min keeps the target tappable on a phone without bloating a dense header.
        padding: compact ? '6px 10px' : '7px 12px', minHeight: 32,
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${state === 'idle' ? 'var(--border-subtle)' : tone}`,
        background: 'var(--bg-base)',
        color: tone,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">{state === 'copied' ? '✓' : state === 'error' ? '⚠' : '⧉'}</span>
      <span>{text}</span>
    </button>
  );
}
