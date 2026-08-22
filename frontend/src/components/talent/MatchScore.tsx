'use client';

/**
 * How a recommendation explains itself.
 *
 * A bare 0..100 next to a stranger's name is an assertion, and an assertion nobody can
 * check is worth less than no number at all. The API returns the REASONS with their
 * points, so the chip is followed by the arithmetic: "skills +38, discipline +12". A
 * client who disagrees with the order can see which term produced it.
 *
 * The reason arrives as a CODE and is localised here. The server never assembles an
 * English sentence — in a five-language product that is a bug shaped like a string.
 */
import { useTranslations } from 'next-intl';
import { matchReasonKey } from './jobVocabulary';
import type { MatchReason } from '@/lib/freelance/matching';

/** Above this a match is worth acting on; below it, worth seeing but not leading with. */
const STRONG_MATCH = 65;

export function MatchScore({ score, reasons }: { score: number; reasons: MatchReason[] }) {
  const t = useTranslations('talent');
  const strong = score >= STRONG_MATCH;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
      <span
        title={t('match.tooltip')}
        style={{
          fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, padding: '3px 9px',
          borderRadius: 'var(--radius-full)', flexShrink: 0,
          background: strong ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
          border: `1px solid ${strong ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
          color: strong ? 'var(--coral-bright)' : 'var(--text-secondary)',
        }}
      >
        {t('match.score', { score })}
      </span>
      {reasons.slice(0, 4).map((reason) => (
        <span
          key={reason.code}
          style={{
            fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)',
            padding: '2px 8px', borderRadius: 'var(--radius-full)',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          }}
        >
          {t(matchReasonKey(reason.code))} +{reason.points}
        </span>
      ))}
    </div>
  );
}

/**
 * The evidence behind the score: what lined up and what did not.
 *
 * The gaps are shown, not hidden. A recommendation that only lists hits reads like an
 * advert; one that names the two skills this person does not have is the one a client can
 * act on without opening five profiles to check.
 */
export function MatchSkills({ matched, missing }: { matched: string[]; missing: string[] }) {
  const t = useTranslations('talent');
  if (matched.length === 0 && missing.length === 0) return null;
  const chip = (text: string, hit: boolean) => (
    <span
      key={`${hit ? 'y' : 'n'}-${text}`}
      style={{
        fontSize: 'var(--font-size-eyebrow)', padding: '2px 8px', borderRadius: 'var(--radius-full)',
        background: hit ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        color: hit ? 'var(--coral-bright)' : 'var(--text-muted)',
        textDecoration: hit ? 'none' : 'line-through',
      }}
    >
      {text}
    </span>
  );
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, minWidth: 0 }}>
      {matched.slice(0, 6).map((skill) => chip(skill, true))}
      {missing.slice(0, 4).map((skill) => chip(skill, false))}
      {missing.length > 4 && (
        <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
          {t('match.moreGaps', { count: missing.length - 4 })}
        </span>
      )}
    </div>
  );
}
