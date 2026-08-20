/**
 * Bullet consolidation — several versions of one résumé, merged into one.
 *
 * The half of this screen people do not expect is `uniqueBullets`, and it is deliberately
 * given as much room as the merges. A bullet that appears in exactly one of the documents
 * is the line a hand-merge silently drops, which is the reason people end up keeping four
 * résumés instead of one. It is listed in full, and nothing here discards it.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Surface } from '@/components/ui';
import { careerAiApi, type BulletMergeOutcome } from '@/lib/careerAiApi';
import { ProvenanceNote, QuotedLine, labelStyle, stackStyle, textAreaStyle } from './careerAiShared';

const MIN_RESUME = 40;
const MAX_SOURCES = 5;

export function MergeBulletsPanel() {
  const t = useTranslations('careerAi');
  const [sources, setSources] = useState<string[]>(['', '']);
  const [outcome, setOutcome] = useState<BulletMergeOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setSource = (index: number, value: string) =>
    setSources((current) => current.map((existing, at) => (at === index ? value : existing)));

  async function run() {
    const texts = sources.map((source) => source.trim()).filter((source) => source.length >= MIN_RESUME);
    if (texts.length < 2) { setError(t('error.needTwo')); return; }
    setBusy(true);
    setError(null);
    try {
      setOutcome(await careerAiApi.mergeBullets(texts));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('error.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={stackStyle}>
      {sources.map((source, index) => (
        <div key={index}>
          <label htmlFor={`career-ai-merge-${index}`} style={labelStyle}>{t('merge.sourceLabel', { number: index + 1 })}</label>
          <textarea
            id={`career-ai-merge-${index}`}
            style={textAreaStyle}
            value={source}
            onChange={(event) => setSource(index, event.target.value)}
            placeholder={t('resumePlaceholder')}
          />
        </div>
      ))}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={run} loading={busy}>{t('run.merge')}</Button>
        {sources.length < MAX_SOURCES && (
          <Button variant="ghost" onClick={() => setSources((current) => [...current, ''])}>{t('merge.addSource')}</Button>
        )}
        {sources.length > 2 && (
          <Button variant="ghost" onClick={() => setSources((current) => current.slice(0, -1))}>{t('merge.removeSource')}</Button>
        )}
      </div>
      {error && <p style={{ margin: 0, color: 'var(--error-text)', fontSize: 'var(--font-size-small)' }}>{error}</p>}

      {outcome && (
        <div style={stackStyle}>
          <ProvenanceNote
            provenance={outcome}
            labels={{
              degraded: (reason) => t('degraded', { reason }),
              cached: t('cached'),
              model: (model) => t('modelLabel', { model }),
            }}
          />

          <h2 style={{ margin: 0, fontSize: 'var(--font-size-section)', color: 'var(--text-primary)' }}>
            {t('merge.groupsHeading', { count: outcome.result.merged.length })}
          </h2>
          {outcome.result.merged.length === 0 && (
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('merge.noGroups')}</p>
          )}

          {outcome.result.merged.map((merged) => (
            <Surface key={merged.id} tone="raised" padding="md">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Badge tone={merged.accepted ? 'success' : 'danger'}>
                  {merged.accepted ? t('merge.accepted') : t(`rewrite.refused.${merged.refusedBecause ?? 'not_answered'}`)}
                </Badge>
                <QuotedLine>{merged.accepted ? merged.merged : merged.fallback}</QuotedLine>
                {!merged.accepted && (
                  <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--warning-text)' }}>
                    {merged.inventedNumbers?.length
                      ? t('rewrite.inventedNumbers', { numbers: merged.inventedNumbers.join(', ') })
                      : t('merge.fallbackNote')}
                  </p>
                )}
                <details>
                  <summary style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    {t('merge.variants', { count: merged.variants.length })}
                  </summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {merged.variants.map((variant, index) => <QuotedLine key={index} muted>{variant}</QuotedLine>)}
                  </div>
                </details>
              </div>
            </Surface>
          ))}

          <Surface tone="sunken" padding="md">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <strong style={{ fontSize: 'var(--font-size-card-title)', color: 'var(--text-primary)' }}>
                {t('merge.uniqueHeading', { count: outcome.result.uniqueBullets.length })}
              </strong>
              <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('merge.uniqueNote')}</p>
              {outcome.result.uniqueBullets.map((bullet, index) => <QuotedLine key={index}>{bullet}</QuotedLine>)}
            </div>
          </Surface>

          {outcome.result.mergedSkills.length > 0 && (
            <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
              {t('merge.skills')} {outcome.result.mergedSkills.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
