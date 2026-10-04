import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData } from '../types';
import { useTranslations } from 'next-intl';
import { formatPitchDuration, PITCH_COMPETITIONS, PITCH_MAX_SCORE, pitchApplicationAnswers, pitchApplicationReadiness, pitchBeats, pitchCompetitionFor, pitchCriteria, pitchEligibility, type PitchLabelled, pitchQaCoverage, pitchQaItems, pitchReadiness, pitchRuntimeSeconds, pitchSpokenSeconds, pitchTimingTone } from '@/lib/pitchCompetition';
import styles from '../CreationCanvas.module.css';

/**
 * Pitch inspector — one panel for all four pitch objects.
 *
 * They differ in what they hold and agree on everything else: they are entered
 * in a competition, they are scored or timed against that competition's own
 * rules, and their content is a list of items a person edits one at a time.
 * Splitting that into four inspectors would have duplicated the competition
 * picker four times and let them drift, so the shape is chosen once here and the
 * rows are chosen by kind.
 *
 * Editing MATERIALIZES: the arrays start empty and the preset supplies the
 * defaults, so the first edit writes the whole normalized list back. After that
 * the object owns its content and a competition change never silently discards
 * what someone wrote.
 */
export const DERIVED_PITCH_FIELDS: ReadonlySet<string> = new Set(['labelKey', 'written', 'answered', 'over', 'chars']);

export function PitchInspector({ node, editable, onChange }: {
  node: CreationFlowNode;
  editable: boolean;
  onChange: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = useTranslations('creationCanvas.pitch');
  const data = node.data;
  const kind = data.kind;
  const competition = pitchCompetitionFor(data);
  /** A preset row is product copy and translates; a renamed row is the author's
   * own words and is shown exactly as they typed it. */
  const label = (item: PitchLabelled) => (item.labelKey && t.has(item.labelKey) ? t(item.labelKey) : item.label);
  /**
   * Write the whole list back with one row changed.
   *
   * The normalized rows carry derived state — the catalog key, whether a beat is
   * written, whether an answer is over length — which is recomputed on every
   * read and must never be persisted; storing it would let a stale `over: false`
   * outlive the text that made it true.
   */
  const patchList = <T extends object>(field: string, items: readonly T[], index: number, change: Partial<T>) => {
    onChange({
      [field]: items.map((item, position) => Object.fromEntries(
        Object.entries({ ...item, ...(position === index ? change : {}) })
          .filter(([key]) => !DERIVED_PITCH_FIELDS.has(key)),
      )),
    });
  };
  const scoreInput = (current: number, onPick: (score: number) => void, name: string) => (
    <div className={styles.pitchScoreInput} role="group" aria-label={t('scoreOutOf', { max: PITCH_MAX_SCORE, name })}>
      {Array.from({ length: PITCH_MAX_SCORE }, (_, index) => index + 1).map((score) => (
        <button
          key={score}
          type="button"
          disabled={!editable}
          aria-pressed={current === score}
          aria-label={t('scoreValue', { score, max: PITCH_MAX_SCORE })}
          onClick={() => onPick(current === score ? 0 : score)}
        >{score}</button>
      ))}
    </div>
  );

  const beats = pitchBeats(data);
  const criteria = pitchCriteria(data);
  const questions = pitchQaItems(data);
  const answers = pitchApplicationAnswers(data);
  const eligibility = pitchEligibility(data);
  const spoken = pitchSpokenSeconds(beats);

  return <section data-inspector-section="pitch">
    <label>{t('competition')}<select
      value={competition.id}
      disabled={!editable}
      onChange={(event) => onChange({ competitionId: event.target.value })}
    >{PITCH_COMPETITIONS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
    <p className={styles.inspectorHint}>{t('competitionHint', {
      pitch: formatPitchDuration(competition.pitchSeconds),
      qa: formatPitchDuration(competition.qaSeconds),
      criteria: competition.criteria.length,
    })}</p>
    {competition.url && <a href={competition.url} target="_blank" rel="noreferrer">{t('officialRules')}</a>}

    {kind === 'pitch' && <>
      <div className={styles.pitchInspectorRow}>
        <div className={styles.pitchInspectorItem} data-over={pitchTimingTone(spoken, competition.pitchSeconds) === 'risk' ? 'true' : 'false'}>
          <strong>{formatPitchDuration(spoken)}</strong>
          <span>{t('spokenAt130', { limit: formatPitchDuration(competition.pitchSeconds) })}</span>
        </div>
        <div className={styles.pitchInspectorItem}>
          <strong>{formatPitchDuration(pitchRuntimeSeconds(beats))}</strong>
          <span>{t('budgetedAcrossBeats', { count: beats.length })}</span>
        </div>
      </div>
      {beats.map((beat, index) => <div key={beat.id} className={styles.pitchInspectorItem}>
        <strong>{label(beat)}</strong>
        <span>{beat.prompt}</span>
        <label>{t('seconds')}<input
          type="number" min="0" max="600" value={beat.seconds} disabled={!editable}
          onChange={(event) => patchList('beats', beats, index, { seconds: Math.max(0, Math.min(600, Number(event.target.value) || 0)) })}
        /></label>
        <label>{t('script')}<textarea
          rows={3} value={beat.script} disabled={!editable} placeholder={beat.prompt}
          onChange={(event) => patchList('beats', beats, index, { script: event.target.value })}
        /></label>
      </div>)}
    </>}

    {kind === 'pitchScorecard' && <>
      <div className={styles.pitchInspectorItem}>
        <strong>{t('readinessPercent', { value: pitchReadiness(criteria) })}</strong>
        <span>{t('readinessHint')}</span>
      </div>
      {criteria.map((criterion, index) => <div key={criterion.id} className={styles.pitchInspectorItem}>
        <strong>{label(criterion)}</strong>
        <span>{criterion.prompt}</span>
        {scoreInput(criterion.score, (score) => patchList('criteria', criteria, index, { score }), label(criterion))}
        <label>{t('evidence')}<textarea
          rows={3} value={criterion.evidence} disabled={!editable} placeholder={t('evidencePlaceholder')}
          onChange={(event) => patchList('criteria', criteria, index, { evidence: event.target.value })}
        /></label>
        <label>{t('gap')}<input
          value={criterion.gap} disabled={!editable} placeholder={t('gapPlaceholder')}
          onChange={(event) => patchList('criteria', criteria, index, { gap: event.target.value })}
        /></label>
      </div>)}
    </>}

    {kind === 'pitchQa' && <>
      <div className={styles.pitchInspectorItem}>
        <strong>{t('rehearsedOf', { answered: pitchQaCoverage(questions).answered, total: questions.length })}</strong>
        <span>{t('qaHint', { qa: formatPitchDuration(competition.qaSeconds) })}</span>
      </div>
      {questions.map((item, index) => <div key={item.id} className={styles.pitchInspectorItem}>
        <label>{t('question')}<input
          value={item.question} disabled={!editable}
          onChange={(event) => patchList('questions', questions, index, { question: event.target.value })}
        /></label>
        <label>{t('answer')}<textarea
          rows={3} value={item.answer} disabled={!editable} placeholder={t('answerPlaceholder')}
          onChange={(event) => patchList('questions', questions, index, { answer: event.target.value })}
        /></label>
        {scoreInput(item.strength, (strength) => patchList('questions', questions, index, { strength }), item.question)}
      </div>)}
      <button type="button" className={styles.fullButton} disabled={!editable} onClick={() => onChange({
        questions: [...questions, { id: `question-${questions.length + 1}-${Date.now().toString(36)}`, question: '', answer: '', strength: 0 }],
      })}>{t('addQuestion')}</button>
    </>}

    {kind === 'pitchApplication' && <>
      <div className={styles.pitchInspectorItem}>
        <strong>{t('completePercent', { value: pitchApplicationReadiness(answers, eligibility).percent })}</strong>
        <span>{pitchApplicationReadiness(answers, eligibility).submittable ? t('readyToSubmit') : t('applicationHint')}</span>
      </div>
      {competition.categories.length > 0 && <label>{t('category')}<select
        value={typeof data.category === 'string' ? data.category : ''}
        disabled={!editable}
        onChange={(event) => onChange({ category: event.target.value })}
      ><option value="">{t('chooseCategory')}</option>{competition.categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>}
      {eligibility.map((rule, index) => <label key={rule.id} className={styles.inspectorHint}>
        <input
          type="checkbox" checked={rule.met} disabled={!editable}
          onChange={(event) => patchList('eligibility', eligibility, index, { met: event.target.checked })}
        /> {label(rule)}
      </label>)}
      {answers.map((answer, index) => <div key={answer.id} className={styles.pitchInspectorItem} data-over={answer.over ? 'true' : 'false'}>
        <strong>{label(answer)}</strong>
        <span>{answer.maxChars > 0 ? t('charCount', { chars: answer.chars, max: answer.maxChars }) : t('noLimit')}</span>
        <textarea
          rows={4} value={answer.answer} disabled={!editable} aria-label={label(answer)}
          onChange={(event) => patchList('answers', answers, index, { answer: event.target.value })}
        />
      </div>)}
    </>}
  </section>;
}
