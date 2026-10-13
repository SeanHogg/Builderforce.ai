/**
 * What the runner read from a page (PRD 33 §5.2 "Capture"): SEO, content, lab
 * performance and accessibility facts as compact meters. `PAGE_FACTS` is DATA —
 * each row reads one number from the capture and says whether it passes the same
 * line the page rules use; a fact the capture does not carry is left out, never
 * shown as zero.
 */

import { useTranslations } from 'next-intl';
import type { ReplayPageCaptureDto } from '@builderforce/interaction-contract';
import { useFormat } from '@/i18n/useFormat';

export type FactGroup = 'seo' | 'content' | 'performance' | 'accessibility';
export const FACT_GROUPS: readonly FactGroup[] = ['seo', 'content', 'performance', 'accessibility'];

export interface PageFact {
  /** Under `replay.page.facts.<id>` (the value is `{value}`). */
  id: string;
  group: FactGroup;
  read(capture: ReplayPageCaptureDto): { value: number; ok: boolean } | null;
}

const ok = (value: number, pass: boolean) => ({ value, ok: pass });

export const PAGE_FACTS: readonly PageFact[] = [
  { id: 'titleLength', group: 'seo', read: (c) => (c.seo ? ok(c.seo.titleLength, c.seo.titleLength >= 30 && c.seo.titleLength <= 60) : null) },
  { id: 'metaDescriptionLength', group: 'seo', read: (c) => (c.seo ? ok(c.seo.metaDescriptionLength, c.seo.metaDescriptionLength >= 50) : null) },
  { id: 'h1Count', group: 'seo', read: (c) => (c.seo ? ok(c.seo.h1Count, c.seo.h1Count === 1) : null) },
  { id: 'structuredData', group: 'seo', read: (c) => (c.seo ? ok(c.seo.structuredDataTypes.length, c.seo.structuredDataTypes.length > 0) : null) },
  { id: 'imagesWithoutAlt', group: 'seo', read: (c) => (c.seo ? ok(c.seo.imageCount - c.seo.imagesWithAlt, c.seo.imagesWithAlt >= c.seo.imageCount) : null) },
  { id: 'aboveFoldWords', group: 'content', read: (c) => (c.content ? ok(c.content.aboveFoldWords, c.content.valuePropAboveFold) : null) },
  { id: 'ctaAboveFold', group: 'content', read: (c) => (c.content ? ok(c.content.ctaAboveFold, c.content.ctaAboveFold > 0) : null) },
  { id: 'readabilityGrade', group: 'content', read: (c) => (c.content?.readabilityGrade != null ? ok(Math.round(c.content.readabilityGrade * 10) / 10, c.content.readabilityGrade <= 12) : null) },
  { id: 'trustSignals', group: 'content', read: (c) => (c.content ? ok(c.content.trustSignals.length, c.content.trustSignals.length > 0) : null) },
  { id: 'lcp', group: 'performance', read: (c) => (c.labPerf?.lcpMs != null ? ok(Math.round(c.labPerf.lcpMs), c.labPerf.lcpMs <= 2_500) : null) },
  { id: 'cls', group: 'performance', read: (c) => (c.labPerf?.cls != null ? ok(c.labPerf.cls / 1000, c.labPerf.cls <= 100) : null) },
  { id: 'pageWeight', group: 'performance', read: (c) => (c.labPerf ? ok(Math.round(c.labPerf.pageWeightBytes / 1024), c.labPerf.pageWeightBytes <= 2 * 1024 * 1024) : null) },
  { id: 'contrastFailures', group: 'accessibility', read: (c) => (c.a11y ? ok(c.a11y.contrastFailures.length, c.a11y.contrastFailures.length === 0) : null) },
  { id: 'smallTapTargets', group: 'accessibility', read: (c) => (c.a11y && c.deviceClass === 'phone' ? ok(c.a11y.smallTapTargets.length, c.a11y.smallTapTargets.length < 3) : null) },
  { id: 'missingLabels', group: 'accessibility', read: (c) => (c.a11y ? ok(c.a11y.missingLabels.length, c.a11y.missingLabels.length === 0) : null) },
];

export function FactMeters({ capture }: { capture: ReplayPageCaptureDto }) {
  const t = useTranslations('replay.page.facts');
  const fmt = useFormat();
  const rows = PAGE_FACTS.flatMap((fact) => {
    const read = fact.read(capture);
    return read ? [{ fact, ...read }] : [];
  });
  if (rows.length === 0) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('none')}</p>;
  return (
    <div data-testid="fact-meters" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-2)' }}>
      {FACT_GROUPS.map((group) => {
        const facts = rows.filter((row) => row.fact.group === group);
        if (facts.length === 0) return null;
        return (
          <section key={group} aria-label={t(`group.${group}`)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
            <strong style={{ fontSize: 'var(--font-size-small)' }}>{t(`group.${group}`)}</strong>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {facts.map(({ fact, value, ok: pass }) => (
                <li key={fact.id} data-fact={fact.id} data-ok={pass} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', fontSize: 'var(--font-size-small)' }}>
                  <span style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{t(`${fact.id}`, { value: fmt.number(value) })}</span>
                  <span style={{ color: pass ? 'var(--success)' : 'var(--warning)', fontWeight: 600, whiteSpace: 'nowrap' }}>{pass ? t('pass') : t('fail')}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
