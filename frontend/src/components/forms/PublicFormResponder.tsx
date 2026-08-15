'use client';

/**
 * The PUBLIC responder — the surface the collection primitive was missing.
 *
 * ── WHAT THIS IS THE OTHER HALF OF ──────────────────────────────────────────
 * The canvas contract declared `PublishedForm`, nine question types, three
 * audiences and an `anonymous` boolean, argued distinction by distinction, with
 * zero consumers. It called `form` "the single largest 'idea to REAL' break the
 * canvas had: it could author anything and collect nothing". This is where an
 * answer comes back from a person who is not in the workspace.
 *
 * ── ONE CONTROL PER DECLARED TYPE, AND NO ESCAPE HATCH ──────────────────────
 * The nine types are closed deliberately: each renders as one accessible control
 * and validates with one rule, and a "custom" type would put validation in the
 * author's prose where nothing can check it. So the switch below is exhaustive
 * over `FormFieldType` and a type the union does not have fails to compile —
 * which is the only way a tenth type gets a control instead of a text box.
 *
 * ── THE RULES THAT ARE *NOT* HERE ───────────────────────────────────────────
 * Whether the form is open, whether this audience may answer, and whether a
 * required question was left blank are all decided on the SERVER
 * (`formPublishing.ts`). The client checks the same things to give an immediate
 * answer, and the server checks them because the client is not the thing that
 * protects anybody. Neither is authoritative by accident.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FormQuestion, PublishedForm } from '@builderforce/creation-canvas-contract';
import { publicForm, submitPublicForm, type PublicFormView } from '@/lib/founderOpsApi';
import styles from './PublicFormResponder.module.css';

type Answers = Record<string, unknown>;

/**
 * Read the form.
 *
 * Client-side rather than in a server component, because the responder has to
 * POST: a form rendered on the server and submitted from the client is two
 * components maintaining one shape, and the shape is the part that must not
 * drift.
 */
function useForm(slug: string, token?: string) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; view: PublicFormView } | { status: 'missing' }>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    publicForm(slug, token)
      .then((view) => { if (!cancelled) setState({ status: 'ready', view }); })
      .catch(() => { if (!cancelled) setState({ status: 'missing' }); });
    // Keyed on the address, which is the only thing that can change it.
    return () => { cancelled = true; };
  }, [slug, token]);
  return state;
}

export function PublicFormResponder({ slug, token }: { slug: string; token?: string }) {
  const t = useTranslations('publicForm');
  const state = useForm(slug, token);
  const [answers, setAnswers] = useState<Answers>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const set = (id: string, value: unknown) => setAnswers((current) => ({ ...current, [id]: value }));

  if (state.status === 'loading') {
    return <main className={styles.page}><div className={styles.sheet}><p className={styles.notice}>{t('loading')}</p></div></main>;
  }
  if (state.status === 'missing') {
    return <main className={styles.page} role="alert"><div className={styles.sheet}><p className={styles.notice}>{t('missing')}</p></div></main>;
  }

  const form: PublishedForm = state.view.form;

  if (done !== null) {
    return (
      <main className={styles.page}>
        <div className={`${styles.sheet} ${styles.done}`}>
          <h1>{t('thanks')}</h1>
          {/* The AUTHORED confirmation, because "thanks" is rarely the useful
              thing to say — an applicant wants to know what happens next. */}
          <p className={styles.notice}>{done || t('thanksFallback')}</p>
        </div>
      </main>
    );
  }

  // A closed form still RESOLVES rather than 404ing, so a late responder is told
  // what happened instead of being shown a broken link.
  if (form.status !== 'open') {
    return (
      <main className={styles.page} role="alert">
        <div className={styles.sheet}>
          <h1 className={styles.title}>{form.title}</h1>
          <p className={styles.notice}>{form.status === 'closed' ? t('closed') : t('notOpen')}</p>
        </div>
      </main>
    );
  }

  if (state.view.recipient?.answered) {
    return (
      <main className={styles.page}>
        <div className={styles.sheet}>
          <h1 className={styles.title}>{form.title}</h1>
          <p className={styles.notice}>{t('alreadyAnswered')}</p>
        </div>
      </main>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const missing = form.questions.find((question) => question.required && isBlank(answers[question.id]));
    if (missing) { setError(t('requiredMissing', { label: missing.label })); return; }
    setSending(true);
    try {
      const result = await submitPublicForm(slug, answers, token);
      setDone(result.confirmationMessage ?? '');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('submitFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <main className={styles.page}>
      <form className={styles.sheet} onSubmit={submit} noValidate>
        <h1 className={styles.title}>{form.title}</h1>
        {form.description && <p className={styles.description}>{form.description}</p>}
        <p className={styles.meta}>
          {/* Stated up front, never in small print at the end: whether an answer
              is attributed is the single fact that changes what a person is
              willing to write, and telling them afterwards is telling them too
              late. */}
          <span>{form.anonymous ? t('anonymousYes') : t('anonymousNo')}</span>
          {form.closesAt && <span>{t('closesAt', { date: form.closesAt.slice(0, 10) })}</span>}
        </p>

        {form.questions.map((question) => (
          <div key={question.id} className={styles.field}>
            <label className={styles.label} htmlFor={`q-${question.id}`}>
              {question.label}
              {question.required && <span className={styles.required} aria-hidden="true">*</span>}
            </label>
            {question.help && <span className={styles.help} id={`h-${question.id}`}>{question.help}</span>}
            <QuestionControl
              question={question}
              value={answers[question.id]}
              onChange={(value) => set(question.id, value)}
              t={t}
            />
          </div>
        ))}

        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.actions}>
          <button type="submit" className={styles.submit} disabled={sending}>
            {sending ? t('submitting') : t('submit')}
          </button>
        </div>
      </form>
    </main>
  );
}

const isBlank = (value: unknown): boolean =>
  value == null || value === '' || (Array.isArray(value) && value.length === 0);

/**
 * ONE control per declared type.
 *
 * The switch is exhaustive over `FormQuestion['type']`, so adding a tenth type to
 * the contract fails to compile here — which is what stops it silently rendering
 * as a text box that collects something nobody asked for.
 */
function QuestionControl({
  question, value, onChange, t,
}: {
  question: FormQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const id = `q-${question.id}`;
  const described = question.help ? { 'aria-describedby': `h-${question.id}` } : {};
  const common = { id, required: question.required, ...described } as const;

  switch (question.type) {
    case 'longText':
      return <textarea {...common} className={styles.textarea} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'email':
      return <input {...common} type="email" inputMode="email" autoComplete="email" className={styles.input} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input {...common} type="number" inputMode="decimal" className={styles.input} value={String(value ?? '')} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'date':
      return <input {...common} type="date" className={styles.input} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select {...common} className={styles.select} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('choosePlaceholder')}</option>
          {(question.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    case 'multiSelect': {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className={styles.choices} role="group" aria-labelledby={id}>
          {(question.options ?? []).map((option) => (
            <label key={option} className={styles.choice}>
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={(e) => onChange(e.target.checked ? [...selected, option] : selected.filter((o) => o !== option))}
              />
              {option}
            </label>
          ))}
        </div>
      );
    }
    case 'scale': {
      // Buttons rather than a range input: a slider's value is invisible until
      // it is dragged, so "5 out of 5" and "not answered" look identical — on
      // the one question type whose whole output is an average.
      const max = question.max ?? 5;
      const current = Number(value);
      return (
        <div className={styles.scale} role="radiogroup" aria-labelledby={id}>
          {Array.from({ length: max }, (_, i) => i + 1).map((point) => (
            <button
              key={point}
              type="button"
              role="radio"
              aria-checked={current === point}
              className={`${styles.scaleButton} ${current === point ? styles.scaleButtonOn : ''}`}
              onClick={() => onChange(point)}
            >
              {point}
            </button>
          ))}
        </div>
      );
    }
    case 'boolean':
      return (
        <div className={styles.choices} role="radiogroup" aria-labelledby={id}>
          {([true, false] as const).map((option) => (
            <label key={String(option)} className={styles.choice}>
              <input
                type="radio"
                name={id}
                checked={value === option}
                onChange={() => onChange(option)}
              />
              {option ? t('yes') : t('no')}
            </label>
          ))}
        </div>
      );
    case 'shortText':
      return <input {...common} type="text" className={styles.input} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
}
