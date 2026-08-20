'use client';

/**
 * Authoring the questions every bidder is asked.
 *
 * ── WHY THE ID IS CARRIED THROUGH AN EDIT ───────────────────────────────────────
 * Each row keeps the `id` the server minted for it. Editing the WORDING of question 3
 * must not orphan the answers already given to question 3, and the id is the only thing
 * that holds them together — so a row that came back from the API sends its id straight
 * back, and only a genuinely new row is left for the server to name.
 *
 * Bounded at ten. A screening form longer than that is not screening, it is an
 * application form, and the point of the feature is to let a client filter a shortlist
 * without reading forty cover notes.
 */
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { SCREENING_QUESTION_TYPES } from './jobVocabulary';
import type { ScreeningQuestion } from '@/lib/freelancerApi';

export type ScreeningQuestionDraft = Omit<ScreeningQuestion, 'id'> & { id?: string };

export const MAX_SCREENING_QUESTIONS = 10;

const field: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
  padding: '7px 10px', fontSize: 'var(--font-size-small)', outline: 'none',
  minWidth: 0, boxSizing: 'border-box',
};

export function ScreeningQuestionsEditor({
  questions,
  onChange,
}: {
  questions: ScreeningQuestionDraft[];
  onChange: (next: ScreeningQuestionDraft[]) => void;
}) {
  const t = useTranslations('publishGig');

  const patch = (index: number, change: Partial<ScreeningQuestionDraft>) => {
    onChange(questions.map((q, i) => (i === index ? { ...q, ...change } : q)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', maxWidth: '65ch' }}>
        {t('screening.explainer')}
      </p>

      {questions.map((question, index) => (
        <div
          key={question.id ?? `new-${index}`}
          style={{
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
            padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
          }}
        >
          <textarea
            style={{ ...field, minHeight: 46, resize: 'vertical', width: '100%' }}
            value={question.prompt}
            maxLength={500}
            placeholder={t('screening.promptPlaceholder')}
            aria-label={t('screening.promptLabel', { number: index + 1 })}
            onChange={(e) => patch(index, { prompt: e.target.value })}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
              {t('screening.type')}
              <select
                style={field}
                value={question.type}
                onChange={(e) => patch(index, { type: e.target.value as ScreeningQuestion['type'] })}
              >
                {SCREENING_QUESTION_TYPES.map((type) => (
                  // A native <option> needs its OWN opaque background and colour — one
                  // that inherits only the wrapper's is unreadable in one of the themes.
                  <option key={type} value={type} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                    {t(`screening.types.${type}`)}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={question.required}
                onChange={(e) => patch(index, { required: e.target.checked })}
              />
              {t('screening.required')}
            </label>
            <button
              type="button"
              onClick={() => onChange(questions.filter((_, i) => i !== index))}
              style={{
                marginLeft: 'auto', padding: '5px 10px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
                color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Icon name="trash" size={13} /> {t('screening.remove')}
            </button>
          </div>
        </div>
      ))}

      {questions.length < MAX_SCREENING_QUESTIONS && (
        <button
          type="button"
          onClick={() => onChange([...questions, { prompt: '', type: 'text', required: false }])}
          style={{
            alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--border-subtle)', background: 'transparent',
            color: 'var(--text-primary)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer',
          }}
        >
          + {t('screening.add')}
        </button>
      )}
    </div>
  );
}

/**
 * Answering them, on the bid form.
 *
 * A required question with no answer is refused by the API, so the form marks it before
 * the round trip rather than letting somebody lose a written proposal to a 400.
 */
export function ScreeningAnswersForm({
  questions,
  answers,
  onChange,
}: {
  questions: ScreeningQuestion[];
  answers: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const t = useTranslations('freelancer');
  if (questions.length === 0) return null;

  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
        {t('jobs.screeningHeading')}
      </div>
      {questions.map((question) => {
        const value = answers[question.id] ?? '';
        const missing = question.required && !value.trim();
        return (
          <label key={question.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
              {question.prompt}
              {question.required && <span style={{ color: 'var(--coral-bright)' }}> *</span>}
            </span>
            {question.type === 'yes_no' ? (
              <select
                style={{ ...field, borderColor: missing ? 'var(--coral-bright)' : 'var(--border-subtle)' }}
                value={value}
                onChange={(e) => onChange({ ...answers, [question.id]: e.target.value })}
              >
                <option value="" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>{t('jobs.screeningChoose')}</option>
                <option value="yes" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>{t('jobs.screeningYes')}</option>
                <option value="no" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>{t('jobs.screeningNo')}</option>
              </select>
            ) : (
              <input
                style={{ ...field, borderColor: missing ? 'var(--coral-bright)' : 'var(--border-subtle)' }}
                type={question.type === 'number' ? 'number' : 'text'}
                value={value}
                maxLength={2000}
                onChange={(e) => onChange({ ...answers, [question.id]: e.target.value })}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

/** The required questions this answer set still leaves blank. The bid button reads it,
 *  so "why is this disabled" is answerable on the page. */
export function unansweredRequired(questions: ScreeningQuestion[], answers: Record<string, string>): string[] {
  return questions.filter((q) => q.required && !(answers[q.id] ?? '').trim()).map((q) => q.prompt);
}
