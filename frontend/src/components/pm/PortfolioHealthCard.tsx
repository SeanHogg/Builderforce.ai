import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { ProjectHealthBadge } from '@/components/ProjectHealth';
import { useProjectStatusLabel } from '@/lib/projectStatus';
import { RAG_COLOR, type PortfolioHealthItem } from '@/lib/pm/portfolioHealth';

/**
 * One project's health card on the Portfolio → Health grid (FR-1): its RAG band, how
 * far along it is, the single biggest impediment, and the one next action.
 *
 * Presentational and self-contained — it takes ONE narrow prop (the derived row) and
 * owns nothing else: no fetch, no scope, no `canX` flag from a parent. Dropping it on
 * another surface needs zero edits, which is why the derivation lives in
 * `lib/pm/portfolioHealth.ts` rather than here.
 *
 * The health chip + progress bar are the shared <ProjectHealthBadge/>, so this card
 * shows the SAME numbers as the project card and the list row.
 *
 * No `'use client'`: the only importer is `PortfolioHealthContent`, which sits under
 * the already-client `PmoContent` boundary, so the directive would mark nothing (see
 * `scripts/check-frontend-architecture.mjs`).
 */

export interface PortfolioHealthCardProps {
  item: PortfolioHealthItem;
}

const cardStyle = (color: string): CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 16,
  background: 'var(--surface-card)',
  border: '1px solid var(--border-subtle)',
  borderTop: `3px solid ${color}`,
  borderRadius: 'var(--radius-lg)',
  minWidth: 0,
});

const eyebrowStyle: CSSProperties = {
  fontSize: 'var(--font-size-eyebrow)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  fontWeight: 600,
};

const labelStyle: CSSProperties = {
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-muted)',
  fontWeight: 600,
};

const sentenceStyle: CSSProperties = {
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-secondary)',
  lineHeight: 1.45,
  overflowWrap: 'anywhere',
};

export function PortfolioHealthCard({ item }: PortfolioHealthCardProps) {
  const t = useTranslations('pmo');
  const statusLabel = useProjectStatusLabel();
  const color = RAG_COLOR[item.rag];
  const ragLabel = t(`health.rag.${item.rag}`);

  return (
    <article style={cardStyle(color)} aria-label={t('health.cardAria', { name: item.name, rag: ragLabel })}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span style={eyebrowStyle}>{statusLabel(item.status)}</span>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 'var(--font-size-small)', fontWeight: 700, color,
            border: `1px solid ${color}`, borderRadius: 'var(--radius-full)', padding: '2px 10px',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} aria-hidden />
          {ragLabel}
        </span>
      </div>

      <Link
        href={`/projects?project=${item.id}&panel=analytics`}
        style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'none', overflowWrap: 'anywhere' }}
      >
        {item.name}
      </Link>

      <div style={{ ...eyebrowStyle, color: 'var(--text-secondary)' }}>
        {t(`health.risk.${item.risk}`)}
      </div>

      <ProjectHealthBadge project={item.project} />

      <div style={sentenceStyle}>
        {t('health.taskSummary', {
          done: item.health.completed,
          total: item.health.total,
          open: item.health.open,
        })}
      </div>

      <div style={sentenceStyle}>
        <span style={labelStyle}>{t('health.blockerLabel')} </span>
        {t(`health.blocker.${item.blocker.key}`, item.blocker.values)}
      </div>

      <div style={sentenceStyle}>
        <span style={labelStyle}>{t('health.actionLabel')} </span>
        <span style={{ color: 'var(--text-primary)' }}>
          {t(`health.action.${item.action.key}`, item.action.values)}
        </span>
      </div>
    </article>
  );
}
