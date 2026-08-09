'use client';

/**
 * The pieces every product-update surface shares: the badges, the body, and the
 * date format.
 *
 * Three surfaces render the same update — the "What's new" changelog behind the
 * footer version, the beta banner, and the beta join panel — and an update that
 * reads "Public beta" in one place and "Beta" in another is a different update as
 * far as the reader is concerned. So the accent, the wording and the paragraph
 * splitting live here once.
 *
 * Every accent is a MID-TONE token that reads on both themes; the pill background
 * is derived from it with color-mix, so no light-only or dark-only surface colour
 * is ever written down.
 */

import { useLocale, useTranslations } from 'next-intl';
import { toStage, type ReleaseNoteStage } from '@/lib/releaseNotesApi';

const CATEGORY_ACCENT: Record<'new' | 'improvement' | 'fix', string> = {
  new: 'var(--indigo-bright)',
  improvement: 'var(--emerald-bright)',
  fix: 'var(--warning)',
};

const STAGE_ACCENT: Record<ReleaseNoteStage, string> = {
  in_development: 'var(--text-muted)',
  private_beta: 'var(--indigo-bright)',
  public_beta: 'var(--warning)',
  live: 'var(--emerald-bright)',
  sunset: 'var(--danger)',
};

export function categoryKey(category: string): 'new' | 'improvement' | 'fix' {
  return category === 'new' || category === 'fix' ? category : 'improvement';
}

/** A stage is a beta when someone could be inside it — the wording that gates
 *  "Join"/"Leave" copy everywhere. */
export function isBetaStage(stage: string): boolean {
  const resolved = toStage(stage);
  return resolved === 'public_beta' || resolved === 'private_beta';
}

function Pill({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        borderRadius: 'var(--radius-full)',
        padding: '2px 10px',
        color: accent,
        background: `color-mix(in srgb, ${accent} 15%, transparent)`,
      }}
    >
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: '50%', background: accent, flexShrink: 0 }}
      />
      {children}
    </span>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  const t = useTranslations('whatsNew');
  const key = categoryKey(category);
  return <Pill accent={CATEGORY_ACCENT[key]}>{t(`categories.${key}`)}</Pill>;
}

export function StageBadge({ stage }: { stage: string }) {
  const t = useTranslations('whatsNew');
  const resolved = toStage(stage);
  return <Pill accent={STAGE_ACCENT[resolved]}>{t(`stages.${resolved}`)}</Pill>;
}

/** Release-note bodies are plain text authored with blank lines between
 *  paragraphs — rendered, never interpreted, so an operator cannot inject markup
 *  into everyone's changelog. */
export function ReleaseNoteBody({ body }: { body: string | null }) {
  const paragraphs = (body ?? '')
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return null;

  return (
    <>
      {paragraphs.map((para, i) => (
        <p key={i} style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          {para}
        </p>
      ))}
    </>
  );
}

/** One date format for every product-update surface, in the reader's locale. */
export function useReleaseNoteDate(): (iso: string) => string {
  const locale = useLocale();
  return (iso: string) =>
    new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));
}
