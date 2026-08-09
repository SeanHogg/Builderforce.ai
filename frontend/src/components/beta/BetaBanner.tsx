'use client';

/**
 * Step 1 of the beta flow: the strip across the top of the app offering the one
 * beta this person has not answered yet — join, or close it.
 *
 * It decides its own visibility and renders nothing for a signed-out visitor, a
 * person with no open beta, or one who has already answered — so no shell, route
 * or page has to know it exists. The banner never chooses WHICH beta to show:
 * the server does that (`bannerBetaId`), so the changelog panel and this strip
 * can never disagree about what is on offer.
 *
 * IN FLOW, not fixed. `.app-frame` is a flex column, so a static strip at its top
 * pushes the shell down instead of covering the nav — which is what a fixed bar
 * would do on every viewport where the strip wraps to two lines.
 *
 * Closing it is an answer ('dismissed'), recorded server-side rather than in this
 * browser: someone who closed it on their laptop has closed it, and the same
 * banner reappearing on their phone would read as a bug.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useBetaPrograms } from '@/lib/betaPrograms';
import { useReleaseNoteDate } from '@/components/releaseNotes/ReleaseNoteParts';
import BetaJoinPanel from './BetaJoinPanel';

export default function BetaBanner() {
  const t = useTranslations('beta');
  const tCommon = useTranslations('common');
  const fmtDate = useReleaseNoteDate();
  const { banner, act } = useBetaPrograms();
  const [panelOpen, setPanelOpen] = useState(false);

  if (!banner) return null;

  return (
    <>
      <div className="beta-banner" role="region" aria-label={t('bannerLabel')}>
        <span className="beta-banner__dot" aria-hidden />
        <p className="beta-banner__text">
          <strong>{banner.title}</strong>{' '}
          <span className="beta-banner__sub">
            {banner.stageEndsAt ? t('bannerLeadDated', { date: fmtDate(banner.stageEndsAt) }) : t('bannerLead')}
          </span>
        </p>
        <button type="button" className="beta-banner__cta" onClick={() => setPanelOpen(true)}>
          {t('joinCta')}
        </button>
        <button
          type="button"
          className="beta-banner__close"
          aria-label={tCommon('dismiss')}
          // Fire-and-forget: the store hides the banner optimistically, and a
          // failed dismissal is worth no error surface — it comes back next load.
          onClick={() => { void act(banner.id, 'dismiss').catch(() => {}); }}
        >
          ×
        </button>
      </div>

      <BetaJoinPanel beta={banner} open={panelOpen} onClose={() => setPanelOpen(false)} />

      <style>{`
        .beta-banner {
          flex: none;
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          padding: 10px 16px;
          border-bottom: 1px solid var(--info-border);
          background: var(--info-bg);
          color: var(--info-text);
          font-size: var(--font-size-small);
        }
        .beta-banner__dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--warning);
          flex: none;
        }
        .beta-banner__text {
          margin: 0;
          flex: 1 1 240px;
          min-width: 0;
          line-height: 1.45;
        }
        .beta-banner__sub { opacity: 0.85; }
        .beta-banner__cta {
          flex: none;
          padding: 6px 14px;
          border-radius: var(--radius-md);
          border: 1px solid currentColor;
          background: transparent;
          color: inherit;
          font-size: var(--font-size-small);
          font-weight: 600;
          cursor: pointer;
          min-height: 32px;
        }
        .beta-banner__cta:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
        .beta-banner__close {
          flex: none;
          width: 32px;
          height: 32px;
          border: 0;
          border-radius: var(--radius-md);
          background: transparent;
          color: inherit;
          opacity: 0.7;
          font-size: var(--font-size-card-title);
          line-height: 1;
          cursor: pointer;
        }
        .beta-banner__close:hover { opacity: 1; background: color-mix(in srgb, currentColor 12%, transparent); }

        /* Narrow: the CTA keeps a full-width tap target rather than being
           squeezed against the close button. */
        @media (max-width: 560px) {
          .beta-banner { gap: 8px; padding: 10px 12px; }
          .beta-banner__cta { flex: 1 1 100%; order: 3; }
        }
      `}</style>
    </>
  );
}
