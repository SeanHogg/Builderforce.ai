'use client';

/**
 * PersonalitySummary — a compact, READ-ONLY view of an agent's/persona's
 * psychometric profile. Where {@link PsychometricEditor} is the Pro editing
 * surface (sliders/questionnaire/import), this is the at-a-glance readout shown
 * wherever you VIEW a personality (agent details, persona detail…), including for
 * viewers who can't (or aren't entitled to) edit it.
 *
 * Self-gating: renders nothing when the profile carries no signal, so callers can
 * drop it in unconditionally.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { usePsychometricCatalog } from '@/lib/usePsychometricCatalog';
import {
  NEUTRAL_SCORE,
  profileHasSignal,
  type CatalogDimension,
  type PsychometricProfile,
} from '@/lib/psychometric';

const HI = 65;
const LO = 35;

export default function PersonalitySummary({ profile }: { profile?: PsychometricProfile }) {
  const t = useTranslations('personalitySummary');
  const { catalog } = usePsychometricCatalog();

  // dimension-id -> label metadata, flattened from every framework.
  const dims = useMemo(() => {
    const m = new Map<string, CatalogDimension>();
    for (const fw of catalog?.frameworks ?? []) for (const d of fw.dimensions) m.set(d.id, d);
    return m;
  }, [catalog]);

  // Traits that actually moved off neutral, strongest signal first.
  const notable = useMemo(
    () =>
      Object.entries(profile?.vector ?? {})
        .filter(([, v]) => typeof v === 'number' && v !== NEUTRAL_SCORE)
        .sort((a, b) => Math.abs(b[1] - NEUTRAL_SCORE) - Math.abs(a[1] - NEUTRAL_SCORE)),
    [profile],
  );

  if (!profileHasSignal(profile)) return null;

  const enne = profile?.enneagramType != null
    ? catalog?.enneagram.find((e) => e.type === profile.enneagramType)
    : undefined;

  const chip = (label: string) => (
    <span
      key={label}
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 9999,
        background: 'var(--surface-2)',
        color: 'var(--text-strong)',
        border: '1px solid var(--border)',
      }}
    >
      {label}
    </span>
  );

  return (
    <section
      aria-label={t('title')}
      style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--surface)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: notable.length ? 12 : 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16 }} aria-hidden>🧠</span>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-strong)' }}>{t('title')}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {enne && chip(`${t('enneagram')} ${enne.type} · ${enne.name}`)}
          {profile?.mbti && chip(`${t('mbti')} ${profile.mbti}`)}
        </div>
      </div>

      {notable.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {notable.map(([id, value]) => {
            const d = dims.get(id);
            const name = d?.name ?? id;
            const band = value >= HI ? 'high' : value <= LO ? 'low' : 'moderate';
            const descriptor = value >= HI ? d?.high : value <= LO ? d?.low : undefined;
            return (
              <div key={id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 12, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-strong)' }} title={d?.description}>
                    {name}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {t(band)}{descriptor ? ` · ${descriptor}` : ''}
                  </span>
                </div>
                {/* Bar: fill = value 0..100. Single accent fill (theme-safe in both
                    modes); the high/low nuance is carried by the descriptor text. */}
                <div
                  role="meter"
                  aria-valuenow={value}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={name}
                  style={{ height: 6, borderRadius: 9999, background: 'var(--surface-2)', overflow: 'hidden' }}
                >
                  <div style={{ width: `${value}%`, height: '100%', background: 'var(--accent, #6366f1)', borderRadius: 9999 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
