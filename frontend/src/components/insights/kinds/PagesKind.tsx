/**
 * The `pages` panel kind (PRD 33 §4.1, D16 "fixes lead"): the site's key pages
 * ranked by opportunity — the sum of their open fixes' impact — each with its fold
 * thumbnail, its score and its top fix. A row opens the page review
 * (`route:<path>:review`). Opened from Do next's header.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayPageListDto, ReplayPageListItemDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { useFormat } from '@/i18n/useFormat';
import { useFindingTitle } from '@/components/replay/prescriptions/PrescriptionParts';
import { usePrescriptionsFor } from '@/components/replay/prescriptions/usePrescriptionsFor';
import { useCaptureImage } from '@/components/replay/pageReview/useCaptureAsset';
import { scoreTone } from '@/components/replay/pageReview/ScoreRings';
import type { InsightPanelKindProps, InsightPanelLevel } from '../panelKinds';
import { PanelPending } from './PanelPending';

/** The page review of a path. */
export function pageReviewLevel(path: string): InsightPanelLevel {
  return { kind: 'route', id: path, tab: 'review' };
}

/** Highest opportunity first; ties by the lower score (more to win). */
export function rankPages(pages: ReplayPageListDto): ReplayPageListItemDto[] {
  return [...pages].sort((a, b) => b.opportunity - a.opportunity || (a.score ?? 101) - (b.score ?? 101));
}

function Thumb({ path, label }: { path: string | null; label: string }) {
  const image = useCaptureImage(path);
  return (
    <span aria-hidden={image.src ? undefined : true} style={{ flex: '0 0 auto', width: 96, aspectRatio: '1440 / 900', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--surface)' }}>
      {/* An object URL from an authorised fetch; next/image cannot optimise a blob. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image.src && <img src={image.src} alt={label} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />}
    </span>
  );
}

export function PagesKind({ siteId, push }: InsightPanelKindProps) {
  const t = useTranslations('insights.pages');
  const errorText = useErrorText();
  const fmt = useFormat();
  const findingTitle = useFindingTitle();
  const { items: fixes } = usePrescriptionsFor({ siteId });
  const [pages, setPages] = useState<ReplayPageListDto | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    replayApi.listPages(siteId)
      .then((found) => { if (live) setPages(found); })
      .catch((failure: unknown) => { if (live) setError(errorText(failure)); });
    return () => { live = false; };
    // errorText is a stable formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  const ranked = useMemo(() => (pages ? rankPages(pages) : []), [pages]);
  const byId = useMemo(() => new Map(fixes.map((p) => [p.id, p])), [fixes]);

  if (!pages) return <PanelPending loading={!error} error={error} />;
  if (ranked.length === 0) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>;
  return (
    <ol data-testid="pages-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {ranked.map((page) => {
        const top = page.topPrescriptionId ? byId.get(page.topPrescriptionId) ?? null : null;
        return (
          <li key={page.path}>
            <button
              type="button"
              data-path={page.path}
              className="btn-ghost"
              aria-label={t('openAria', { path: page.path })}
              onClick={() => push(pageReviewLevel(page.path))}
              style={{ width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', textAlign: 'left' }}
            >
              <Thumb path={page.foldThumbUrl} label={t('thumbAlt', { path: page.path })} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 auto' }}>
                <strong style={{ overflowWrap: 'anywhere', color: 'var(--text-primary)' }}>{page.path}</strong>
                <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                  {top ? findingTitle(top) : t('noFix')}
                </span>
                {page.opportunity > 0 && (
                  <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('opportunity', { value: fmt.number(page.opportunity) })}</span>
                )}
              </span>
              <span
                data-testid="page-score"
                style={{ flex: '0 0 auto', fontWeight: 700, color: page.score === null ? 'var(--text-secondary)' : scoreTone(page.score) }}
              >
                {page.score === null ? t('noScore') : t('score', { score: Math.round(page.score) })}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
