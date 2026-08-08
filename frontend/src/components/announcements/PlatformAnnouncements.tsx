'use client';

/**
 * The platform's message to whoever is on the page.
 *
 * Mounted ONCE, app-wide, beside the other always-on chrome — it decides its own
 * visibility and renders nothing when there is nothing targeted at this visitor,
 * so no shell, page or route has to know it exists. That is deliberate: the whole
 * point is reaching anonymous visitors on marketing pages AND signed-in users in
 * the app, and a banner each shell had to opt into would reach neither reliably.
 *
 * Bottom-LEFT, because every other corner is taken: the Brain launcher owns
 * bottom-right, the feedback tab owns the right edge, and the Creation Canvas
 * composer owns bottom-centre. On narrow viewports it spans the width and sits
 * above the mobile bottom bar rather than under it.
 *
 * Tone is a token NAME, never a colour. The four tones resolve through the
 * theme's own `--{tone}-bg / -border / -text` triplets, so one broadcast reads
 * correctly in light and dark without this file knowing either palette.
 */

import { useTranslations } from 'next-intl';
import { usePlatformBroadcasts, type BroadcastTone } from '@/lib/platformBroadcasts';

/**
 * Tone → the theme variables that paint it.
 *
 * `--success-border` is the one member of the family the theme does not define,
 * so it borrows `--success` rather than falling back to a hex that would only be
 * right in one theme.
 */
const TONE_TOKENS: Record<BroadcastTone, { bg: string; border: string; text: string }> = {
  info:     { bg: 'var(--info-bg)',    border: 'var(--info-border)',            text: 'var(--info-text)' },
  success:  { bg: 'var(--success-bg)', border: 'var(--success)',                text: 'var(--success-text)' },
  warning:  { bg: 'var(--warning-bg)', border: 'var(--warning-border)',         text: 'var(--warning-text)' },
  critical: { bg: 'var(--danger-bg)',  border: 'var(--danger-border)',          text: 'var(--danger-text)' },
};

export function PlatformAnnouncements() {
  const t = useTranslations('announcements');
  const { broadcasts, dismiss, onClick } = usePlatformBroadcasts();

  if (!broadcasts.length) return null;

  return (
    <aside className="bf-announcements" aria-label={t('regionLabel')}>
      {broadcasts.map((broadcast) => {
        const tone = TONE_TOKENS[broadcast.tone] ?? TONE_TOKENS.info;
        return (
          <div
            key={broadcast.id}
            className="bf-announcement"
            role="status"
            style={{ background: tone.bg, borderColor: tone.border, color: tone.text }}
          >
            <span className="bf-announcement-rail" style={{ background: tone.border }} aria-hidden="true" />
            <div className="bf-announcement-body">
              <p className="bf-announcement-message">{broadcast.message}</p>
              {broadcast.ctaHref && (
                <a
                  className="bf-announcement-cta"
                  href={broadcast.ctaHref}
                  onClick={() => onClick(broadcast.id)}
                >
                  {broadcast.ctaLabel || t('defaultCta')}
                </a>
              )}
            </div>
            {broadcast.dismissible && (
              <button
                type="button"
                className="bf-announcement-close"
                onClick={() => dismiss(broadcast.id)}
                aria-label={t('dismiss')}
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      <style>{`
        .bf-announcements {
          position: fixed;
          left: 20px;
          bottom: 20px;
          z-index: 9990;
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: min(360px, calc(100vw - 40px));
          pointer-events: none;
        }
        .bf-announcement {
          position: relative;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          overflow: hidden;
          padding: 12px 12px 12px 16px;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg, 12px);
          background: var(--surface-card);
          color: var(--text);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
          pointer-events: auto;
        }
        .bf-announcement-rail {
          position: absolute;
          inset: 0 auto 0 0;
          width: 4px;
        }
        .bf-announcement-body { flex: 1; min-width: 0; }
        .bf-announcement-message {
          margin: 0;
          font-size: 13px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .bf-announcement-cta {
          display: inline-block;
          margin-top: 6px;
          font-size: 13px;
          font-weight: 600;
          color: inherit;
          text-decoration: underline;
        }
        .bf-announcement-close {
          flex: none;
          width: 28px;
          height: 28px;
          border: 0;
          border-radius: var(--radius-md, 8px);
          background: transparent;
          color: inherit;
          opacity: 0.7;
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
        }
        .bf-announcement-close:hover { opacity: 1; background: var(--surface-interactive-hover); }

        /* Narrow: full width, and clear of the mobile bottom bar rather than
           tucked underneath it. */
        @media (max-width: 768px) {
          .bf-announcements {
            left: 12px;
            right: 12px;
            width: auto;
            bottom: calc(56px + 12px + env(safe-area-inset-bottom, 0px));
          }
        }
      `}</style>
    </aside>
  );
}
