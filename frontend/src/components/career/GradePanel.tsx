/**
 * The graded read — two scores on one scale, and the gaps that cost the points.
 *
 * Both numbers are always on screen and they are never averaged. A measured score is a
 * count over the document and does not move unless the document does; a model score is a
 * judgement and moves if you ask again. Collapsing them into one figure would produce a
 * number with neither property, and the places they diverge — which this panel states in
 * a sentence apiece — are the only part of the exercise worth acting on.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Surface } from '@/components/ui';
import { careerAiApi, type ResumeGradeOutcome } from '@/lib/careerAiApi';
import { GradedRow, ProvenanceNote, fieldStyle, labelStyle, stackStyle, textAreaStyle } from './careerAiShared';

const MIN_RESUME = 40;

export function GradePanel() {
  const t = useTranslations('careerAi');
  const [resumeText, setResumeText] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [outcome, setOutcome] = useState<ResumeGradeOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (resumeText.trim().length < MIN_RESUME) { setError(t('error.needResume')); return; }
    setBusy(true);
    setError(null);
    try {
      setOutcome(await careerAiApi.grade(resumeText.trim(), jobDescription.trim() || undefined));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('error.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={stackStyle}>
      <div>
        <label htmlFor="career-ai-grade-resume" style={labelStyle}>{t('resumeLabel')}</label>
        <textarea
          id="career-ai-grade-resume"
          style={textAreaStyle}
          value={resumeText}
          onChange={(event) => setResumeText(event.target.value)}
          placeholder={t('resumePlaceholder')}
        />
      </div>
      <div>
        <label htmlFor="career-ai-grade-job" style={labelStyle}>{t('jobLabel')}</label>
        <textarea
          id="career-ai-grade-job"
          style={{ ...fieldStyle, minHeight: 120, resize: 'vertical' }}
          value={jobDescription}
          onChange={(event) => setJobDescription(event.target.value)}
          placeholder={t('jobPlaceholder')}
        />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={run} loading={busy}>{t('run.grade')}</Button>
        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('grade.note')}</span>
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

          <Surface tone="raised" padding="md">
            <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
              <ScoreTile label={t('grade.measured')} value={outcome.grade.measured.overall} />
              <ScoreTile label={t('grade.model')} value={outcome.grade.modelOverall} />
            </div>
            <p style={{ margin: '12px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
              {outcome.grade.verdict}
            </p>
          </Surface>

          {outcome.grade.disagreements.length > 0 && (
            <Surface tone="sunken" padding="md">
              <strong style={{ fontSize: 'var(--font-size-card-title)', color: 'var(--text-primary)' }}>{t('grade.disagreementsHeading')}</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {outcome.grade.disagreements.map((line, index) => (
                  <li key={index} style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{line}</li>
                ))}
              </ul>
            </Surface>
          )}

          <Surface tone="raised" padding="md">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {outcome.grade.categories.map((category) => (
                <GradedRow
                  key={category.key}
                  category={category}
                  labels={{ measured: t('grade.measuredShort'), model: t('grade.modelShort'), disagrees: t('grade.disagrees') }}
                />
              ))}
            </div>
          </Surface>
        </div>
      )}
    </div>
  );
}

function ScoreTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120 }}>
      <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 'var(--font-size-hero)', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>
        {value == null ? '—' : value}
      </span>
    </div>
  );
}
