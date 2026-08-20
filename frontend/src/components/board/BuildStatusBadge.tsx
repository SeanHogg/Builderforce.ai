'use client';

import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { TaskBuildStatus } from '@/lib/builderforceApi';

/**
 * The ticket's BUILD verdict, as one badge.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * A failing PR-branch build surfaced on the ticket's PR tab and nowhere else, so the two
 * surfaces a person actually scans — the board card and the execution chip — showed a
 * ticket sitting quietly in review while its branch could not build. Finding a red build
 * meant opening every ticket in turn.
 *
 * ── ONE BADGE, TWO SURFACES ──────────────────────────────────────────────────────
 * The card (through `TaskBadges`, which is also the table row and the ticket drawer) and
 * the execution chip render THIS component, so a red build cannot say one thing in one
 * place and another somewhere else. It decides its own visibility: an `unknown` or absent
 * verdict renders nothing, so callers mount it unconditionally rather than gating on a
 * "has a build" flag.
 *
 * The verdict itself is derived server-side from the ticket's current pull request
 * (`api/src/domain/task/buildStatus.ts`) — an open PR wins over a settled one — and rides
 * the list read the card already makes, so no surface pays a query for it.
 *
 * TONE comes from the platform's own `.ui-badge--*` classes, which carry the light AND
 * dark colour trio for each tone. Only the GEOMETRY is set here, because the badge sits in
 * a 10px chip row on the card and inside a small pill on the execution chip; the default
 * `.ui-badge` size would tower over both.
 */

type KnownBuildStatus = Exclude<TaskBuildStatus, 'unknown'>;

/** Tone class + glyph per verdict. Passing is deliberately quiet; failing is not. */
const TONE: Record<KnownBuildStatus, { className: string; glyph: string }> = {
  passing: { className: 'ui-badge ui-badge--success', glyph: '✓' },
  failing: { className: 'ui-badge ui-badge--danger', glyph: '✕' },
  pending: { className: 'ui-badge ui-badge--warning', glyph: '◐' },
};

/** Dense geometry for the chip rows this badge lives in (card, table, drawer, chip). */
const DENSE = {
  minHeight: 0,
  padding: '1px 6px',
  fontSize: 10,
  gap: 3,
  borderRadius: 'var(--radius-sm)',
  maxWidth: '100%',
} as const;

export function BuildStatusBadge({ status }: { status?: TaskBuildStatus | null }) {
  const t = useTranslations('board.build');
  if (!status || status === 'unknown') return null;
  const tone = TONE[status];

  return (
    <span
      className={tone.className}
      style={DENSE}
      title={t(`title.${status}`)}
    >
      <Icon source={tone.glyph} size="1em" />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(`short.${status}`)}</span>
    </span>
  );
}
