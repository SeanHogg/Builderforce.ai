/**
 * Rewrite to XYZ — "accomplished [X] as measured by [Y], by doing [Z]".
 *
 * The screen's job is to make the REFUSALS as visible as the successes. A rewrite that
 * was thrown away for asserting a figure the résumé does not contain is rendered beside
 * the original it failed to replace, naming the number it invented — because the person
 * needs to know that their document still has that gap, and that the tool did not quietly
 * paper over it. A panel that showed only the accepted rewrites would look better and be
 * worth much less.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Surface } from '@/components/ui';
import { careerAiApi, type XyzPart, type XyzRewriteOutcome } from '@/lib/careerAiApi';
import { MissingParts, ProvenanceNote, QuotedLine, ScoreRow, labelStyle, stackStyle, textAreaStyle } from './careerAiShared';

const MIN_RESUME = 40;

export function RewriteBulletsPanel() {
  const t = useTranslations('careerAi');
  const [resumeText, setResumeText] = useState('');
  const [outcome, setOutcome] = useState<XyzRewriteOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partLabel = (part: XyzPart) => t(`xyz.${part}`);

  async function run() {
    if (resumeText.trim().length < MIN_RESUME) { setError(t('error.needResume')); return; }
    setBusy(true);
    setError(null);
    try {
      setOutcome(await careerAiApi.rewriteBullets(resumeText.trim()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('error.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={stackStyle}>
      <div>
        <label htmlFor="career-ai-rewrite-resume" style={labelStyle}>{t('resumeLabel')}</label>
        <textarea
          id="career-ai-rewrite-resume"
          style={textAreaStyle}
          value={resumeText}
          onChange={(event) => setResumeText(event.target.value)}
          placeholder={t('resumePlaceholder')}
        />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={run} loading={busy}>{t('run.rewrite')}</Button>
        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('rewrite.groundedNote')}</span>
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

          <Surface tone="sunken" padding="md">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <strong style={{ fontSize: 'var(--font-size-card-title)', color: 'var(--text-primary)' }}>
                {t('measuredHeading', { score: outcome.brief.score.overall })}
              </strong>
              {outcome.brief.score.categories.map((category) => <ScoreRow key={category.key} category={category} />)}
            </div>
          </Surface>

          <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
            {t('rewrite.counts', {
              accepted: outcome.result.accepted,
              total: outcome.brief.candidates.length,
              strong: outcome.brief.alreadyStrong,
            })}
            {outcome.brief.deferred > 0 ? ` ${t('rewrite.deferred', { count: outcome.brief.deferred })}` : ''}
          </p>
          {outcome.result.refusedForInventedMetric > 0 && (
            <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--warning-text)' }}>
              {t('rewrite.refusedSummary', { count: outcome.result.refusedForInventedMetric })}
            </p>
          )}

          {outcome.result.rewrites.length === 0 && (
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('rewrite.nothingToDo')}</p>
          )}

          {outcome.result.rewrites.map((rewrite) => (
            <Surface key={rewrite.id} tone="raised" padding="md">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Badge tone={rewrite.accepted ? 'success' : 'danger'}>
                    {rewrite.accepted ? t('rewrite.accepted') : t(`rewrite.refused.${rewrite.refusedBecause ?? 'not_answered'}`)}
                  </Badge>
                  <MissingParts parts={rewrite.missing} label={partLabel} />
                </div>

                <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('rewrite.original')}</span>
                <QuotedLine muted={rewrite.accepted}>{rewrite.original}</QuotedLine>

                {rewrite.accepted && (
                  <>
                    <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('rewrite.rewritten')}</span>
                    <QuotedLine>{rewrite.rewritten}</QuotedLine>
                  </>
                )}

                {rewrite.inventedNumbers?.length ? (
                  <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--warning-text)' }}>
                    {t('rewrite.inventedNumbers', { numbers: rewrite.inventedNumbers.join(', ') })}
                  </p>
                ) : null}

                {rewrite.ask ? (
                  <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
                    {t('rewrite.ask')} {rewrite.ask}
                  </p>
                ) : null}
              </div>
            </Surface>
          ))}

          {outcome.result.rewrites.length > 0 && (
            <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{outcome.result.instruction}</p>
          )}
        </div>
      )}
    </div>
  );
}
