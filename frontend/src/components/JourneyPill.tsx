'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { METHOD_STAGES } from '@/lib/methodology';
import { useFounderJourney } from '@/lib/useFounderJourney';
import { SlideOutPanel } from './SlideOutPanel';

/**
 * JourneyPill — a header chip naming where the tenant sits on the founder's
 * journey (Idea → Make → Run → Measure), for once account setup is done.
 * Mirrors `OnboardingProgressPill`'s shape (self-gating render, a slide-out
 * for the detail) and shares `useFounderJourney()` with the dashboard panel's
 * `StageHeaderSwitcher`/`ActRail` rather than recomputing the position.
 *
 * Self-gating: renders nothing with no signal yet (a brand-new tenant with no
 * idea and no company) — TopBar drops it in unconditionally.
 */
export function JourneyPill() {
  const t = useTranslations('nav');
  const router = useRouter();
  const journey = useFounderJourney();
  const [open, setOpen] = useState(false);

  if (!journey.stage) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('journey.label')}
        aria-label={t('journey.label')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 30, padding: '0 10px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
          border: `1px solid var(--stage-${journey.stage})`,
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)', fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, whiteSpace: 'nowrap',
        }}
      >
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: `var(--stage-${journey.stage})` }} />
        {t(`stage.${journey.stage}`)}
      </button>

      <SlideOutPanel open={open} onClose={() => setOpen(false)} title={t('journey.label')} width="sheet" widthStorageKey="journey-pill">
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {METHOD_STAGES.map((stage) => (
            <div
              key={stage}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 'var(--radius-lg)',
                border: `1px solid ${stage === journey.stage ? `var(--stage-${stage})` : 'var(--border-subtle)'}`,
                background: 'var(--bg-base)',
              }}
            >
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', background: `var(--stage-${stage})`, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' }}>{t(`stage.${stage}`)}</strong>
              </div>
              {stage === journey.stage && <Icon source="●" size={10} aria-hidden />}
            </div>
          ))}
          <button
            type="button"
            onClick={() => { setOpen(false); router.push('/dashboard'); }}
            style={{
              marginTop: 6, alignSelf: 'stretch', padding: '10px 16px', borderRadius: 'var(--radius-lg)', cursor: 'pointer',
              border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: 'var(--text-on-accent)', fontWeight: 700, fontSize: 'var(--font-size-body)',
            }}
          >
            {t('journey.openDashboard')}
          </button>
        </div>
      </SlideOutPanel>
    </>
  );
}
