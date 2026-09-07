'use client';

import { useTranslations } from 'next-intl';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

/**
 * A link somebody is meant to send to somebody else: the URL, readable and selectable,
 * with one copy button beside it.
 *
 * ── WHY IT IS A COMPONENT AND NOT A PATTERN ──────────────────────────────────────
 * There are two share motions in the product that produce a URL a person forwards — the
 * logged-out guest room and a signed-in owner's canvas invite link — and until this
 * existed only the first had a control for it. The second was about to grow its own,
 * with its own idea of whether the URL is shown or hidden behind a button, its own
 * handling of a refused clipboard, and its own copy. Two of those and they drift; the
 * one that drifts is always the one where the clipboard silently fails.
 *
 * ── WHY THE URL IS ALWAYS VISIBLE ────────────────────────────────────────────────
 * Clipboard access needs a secure context and can be refused by permission policy. A
 * share affordance that can fail silently is worse than one you can read and select by
 * hand, so `copy` is the convenience and the visible field is the guarantee.
 *
 * It owns its own strings (`common.*`) rather than taking labels, so a second surface
 * cannot introduce a second wording for "Copied".
 */
export function ShareLinkField({
  url, ariaLabel, disabled = false, disabledLabel, compact = false,
}: {
  url: string;
  /** What this link IS, for a screen reader — the surrounding panel has the visible heading. */
  ariaLabel: string;
  /** The link cannot usefully be sent right now (a full room, an exhausted link). */
  disabled?: boolean;
  /** Why, on the button itself. Required in spirit whenever `disabled` is set — a
   *  greyed button with no reason is the failure this replaces. */
  disabledLabel?: string;
  /** Tighter layout for a dense bar. */
  compact?: boolean;
}) {
  const t = useTranslations('common');
  const { copy, state } = useCopyToClipboard();

  return (
    <div className={`slf-root ${compact ? 'slf-compact' : ''}`}>
      <div className="slf-row">
        <input
          className="slf-url"
          value={url}
          readOnly
          aria-label={ariaLabel}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="slf-copy"
          disabled={disabled}
          onClick={() => { void copy(url); }}
        >
          {disabled ? (disabledLabel ?? t('unavailable')) : state === 'copied' ? t('copied') : t('copyLink')}
        </button>
      </div>
      {state === 'error' && <p className="slf-error" role="alert">{t('copyFallback')}</p>}

      <style>{`
        .slf-root { display: flex; flex-direction: column; gap: 6px; width: 100%; min-width: 0; }
        .slf-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .slf-url {
          flex: 1 1 180px; min-width: 0; box-sizing: border-box;
          padding: 7px 9px; font-size: var(--font-size-small); font-family: inherit;
          border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
          background: var(--bg-base); color: var(--text-primary);
          text-overflow: ellipsis;
        }
        .slf-copy {
          flex: 0 0 auto; padding: 7px 12px; font-size: var(--font-size-small); font-weight: 600;
          border-radius: var(--radius-md); border: 1px solid var(--accent);
          background: var(--accent); color: var(--text-on-accent); cursor: pointer; min-height: 32px;
        }
        .slf-copy:disabled { opacity: 0.55; cursor: default; }
        .slf-error { margin: 0; font-size: var(--font-size-eyebrow); color: var(--danger); }
        .slf-compact .slf-url { font-size: var(--font-size-eyebrow); padding: 5px 8px; }
        @media (max-width: 420px) {
          .slf-row { flex-direction: column; align-items: stretch; }
          .slf-copy { width: 100%; }
        }
      `}</style>
    </div>
  );
}
