/**
 * The guided setup — the wizard a template is set up in.
 *
 * ── ONE RENDERER, ONE REGISTRY ──────────────────────────────────────────────
 * The server resolves the plan; this renders it. Every step arrives already
 * judged — satisfied or not, with the reason and (for a picker) the live
 * options — so this component never re-implements a validation rule. That is
 * the whole point of the split: a wizard that validated on the client and an
 * install that trusted it is how a template lands half-configured.
 *
 * The step KINDS are a registry here too, mirroring the server's. A new kind is
 * a `STEP_FIELDS` entry, not a fifth branch in a growing `switch` that some
 * other surface will forget to extend.
 *
 * It is a SlideOutPanel, not a modal: a modal is reserved for terminal
 * destructive approvals, and this is a form.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Icon } from '@/components/ui/Icon';
import {
  templatesApi,
  TemplateSetupIncompleteError,
  type GuidedAnswer,
  type GuidedAnswers,
  type GuidedPlan,
  type InstalledOutput,
  type ResolvedGuidedStep,
  type ScheduleAnswer,
} from '@/lib/templates/api';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  color: 'var(--text-primary)',
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
};

/** Native `<option>`s need their own opaque colours — they are painted by the
 *  OS, which does not inherit the page's theme. */
const optionStyle: React.CSSProperties = { background: 'var(--bg-elevated)', color: 'var(--text-primary)' };

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '10px 18px',
  fontWeight: 600,
  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
  color: 'var(--text-on-accent)',
  border: 'none',
  borderRadius: 'var(--radius-lg)',
  cursor: 'pointer',
};

const subtleBtn: React.CSSProperties = {
  padding: '8px 14px',
  fontWeight: 600,
  color: 'var(--coral-bright)',
  background: 'var(--bg-base)',
  border: '1px solid var(--coral-bright)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

interface FieldProps {
  resolved: ResolvedGuidedStep;
  value: GuidedAnswer;
  onChange: (value: GuidedAnswer) => void;
  /** Where a `connect` step sends somebody to supply the credential. */
  onConnect: (connectorKey: string) => void;
  /** Localized label for the schedule's timezone input. Passed in rather than
   *  translated here so the renderers stay pure functions of their props. */
  timezoneLabel: string;
}

/** The per-kind renderers. The extension point — see the header. */
const STEP_FIELDS: Record<string, (props: FieldProps) => React.ReactNode> = {
  connect: ({ resolved, onConnect }) => (
    <button
      type="button"
      className="ui-text-small"
      style={{ ...subtleBtn, opacity: resolved.satisfied ? 0.6 : 1 }}
      onClick={() => onConnect(resolved.step.connector ?? '')}
      disabled={resolved.satisfied}
    >
      {resolved.satisfied ? <><Icon source="check" size="1em" /> {resolved.step.connector}</> : resolved.step.connector}
    </button>
  ),

  field: ({ resolved, value, onChange }) => {
    const { step } = resolved;
    const common = { style: fieldStyle, id: `step-${step.id}`, placeholder: step.placeholder ?? '' };
    if (step.fieldType === 'multiline') {
      return <textarea {...common} className="ui-text-body" rows={4} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    }
    return (
      <input
        {...common}
        className="ui-text-body"
        type={step.fieldType === 'secret' ? 'password' : step.fieldType === 'number' ? 'number' : step.fieldType === 'email' ? 'email' : 'text'}
        value={String(value ?? '')}
        onChange={(e) => onChange(step.fieldType === 'number' ? Number(e.target.value) : e.target.value)}
      />
    );
  },

  choice: ({ resolved, value, onChange }) => (
    <select
      id={`step-${resolved.step.id}`}
      className="ui-text-body"
      style={fieldStyle}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" style={optionStyle}>—</option>
      {(resolved.options ?? []).map((o) => (
        <option key={o.value} value={o.value} style={optionStyle}>{o.label}</option>
      ))}
    </select>
  ),

  resource: ({ resolved, value, onChange }) => (
    <select
      id={`step-${resolved.step.id}`}
      className="ui-text-body"
      style={fieldStyle}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" style={optionStyle}>—</option>
      {(resolved.options ?? []).map((o) => (
        <option key={o.value} value={o.value} style={optionStyle}>{o.label}{o.help ? ` · ${o.help}` : ''}</option>
      ))}
    </select>
  ),

  // A cron expression and an IANA zone id are not copy — they are the values
  // themselves — so the placeholders come from the step's own declared defaults
  // rather than from a message catalog that would have to "translate" `UTC`.
  schedule: ({ resolved, value, onChange, timezoneLabel }) => {
    const current = (value ?? {}) as Partial<ScheduleAnswer>;
    const fallbackZone = resolved.step.defaultTimezone ?? 'UTC';
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          id={`step-${resolved.step.id}`}
          className="ui-text-body"
          style={{ ...fieldStyle, flex: '2 1 160px' }}
          value={current.cron ?? ''}
          onChange={(e) => onChange({ cron: e.target.value, timezone: current.timezone ?? fallbackZone })}
          placeholder={resolved.step.defaultCron ?? ''}
        />
        <input
          className="ui-text-body"
          style={{ ...fieldStyle, flex: '1 1 120px' }}
          value={current.timezone ?? fallbackZone}
          onChange={(e) => onChange({ cron: current.cron ?? '', timezone: e.target.value })}
          placeholder={fallbackZone}
          aria-label={timezoneLabel}
        />
      </div>
    );
  },

  toggle: ({ resolved, value, onChange }) => (
    <label className="ui-text-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
      <input
        id={`step-${resolved.step.id}`}
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
      {resolved.step.help ?? resolved.step.title}
    </label>
  ),
};

export function GuidedSetupPanel({ templateKey, templateName, open, onClose }: {
  templateKey: string;
  templateName: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('templates');
  const tc = useTranslations('common');
  const router = useRouter();

  const [answers, setAnswers] = useState<GuidedAnswers>({});
  const [touched, setTouched] = useState<string[]>([]);
  const [plan, setPlan] = useState<GuidedPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [outputs, setOutputs] = useState<InstalledOutput[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Re-resolve the plan server-side. Every answer change goes through here, so
   *  a sourced pick-list and a just-connected integration both appear without
   *  the wizard having to know which of the two happened. */
  const refresh = useCallback(async (nextAnswers: GuidedAnswers, nextTouched: string[]) => {
    setLoading(true);
    setError(null);
    try {
      setPlan(await templatesApi.setup(templateKey, nextAnswers, nextTouched));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('setupFailed'));
    } finally {
      setLoading(false);
    }
  }, [templateKey, t]);

  useEffect(() => {
    if (!open) return;
    setOutputs(null);
    void refresh(answers, touched);
    // Deliberately keyed on `open` alone: re-resolving on every keystroke would
    // put an outbound integration call behind each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refresh]);

  const setAnswer = (id: string, value: GuidedAnswer) => {
    setAnswers((current) => ({ ...current, [id]: value }));
  };

  /** Commit an answer: mark the step visited and re-resolve. Runs on blur, not
   *  on change, so a person is not told their half-typed email is invalid. */
  const commit = (id: string) => {
    const nextTouched = touched.includes(id) ? touched : [...touched, id];
    setTouched(nextTouched);
    void refresh(answers, nextTouched);
  };

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      const result = await templatesApi.install(templateKey, answers);
      setOutputs(result.outputs);
    } catch (e) {
      if (e instanceof TemplateSetupIncompleteError) {
        // The server is the authority on readiness; adopt its verdict rather
        // than arguing with it, and mark every step visited so each problem is
        // visible at once instead of one at a time.
        setTouched(plan?.steps.map((s) => s.step.id) ?? []);
        void refresh(answers, plan?.steps.map((s) => s.step.id) ?? []);
        setError(t('setupIncomplete'));
      } else {
        setError(e instanceof Error ? e.message : t('installFailed'));
      }
    } finally {
      setInstalling(false);
    }
  };

  const progress = useMemo(() => {
    if (!plan) return { done: 0, total: 0 };
    const required = plan.steps.filter((s) => s.step.required);
    return { done: required.filter((s) => s.satisfied).length, total: required.length };
  }, [plan]);

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={templateName}
      // The progress line rides as the crumb: a wizard's most useful piece of
      // chrome is "how much is left", and it belongs above the title rather
      // than competing with the step the person is answering.
      crumb={outputs ? t('installed') : t('progress', { done: progress.done, total: progress.total })}
      width="sheet"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 4 }}>
        {error && (
          <div className="ui-text-small" style={{ padding: 12, color: 'var(--coral-bright)', background: 'var(--surface-coral-soft, rgba(244,114,94,0.12))', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            {error}
          </div>
        )}

        {outputs ? (
          <>
            <p className="ui-text-small" style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('installedBody')}</p>
            {outputs.map((output) => (
              <div key={output.outputId} style={{ padding: 14, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon source={output.ok ? 'check' : 'warning'} size="1em" />
                  <strong className="ui-text-card-title" style={{ color: 'var(--text-primary)' }}>{output.label}</strong>
                </div>
                <div className="ui-text-small" style={{ color: output.ok ? 'var(--text-muted)' : 'var(--coral-bright)', marginTop: 4 }}>
                  {output.error ?? output.detail}
                </div>
                {output.href && (
                  <button type="button" className="ui-text-small" style={{ ...subtleBtn, marginTop: 10 }} onClick={() => router.push(output.href!)}>
                    {t('openOutput')}
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="ui-text-small" style={primaryBtn} onClick={onClose}>{tc('done')}</button>
          </>
        ) : (
          <>
            {loading && !plan && <div className="ui-text-small" style={{ color: 'var(--text-muted)' }}>{t('loadingSetup')}</div>}

            {plan?.steps.map((resolved) => {
              const render = STEP_FIELDS[resolved.step.kind];
              return (
                <div key={resolved.step.id} onBlur={() => commit(resolved.step.id)}>
                  <label
                    htmlFor={`step-${resolved.step.id}`}
                    className="ui-text-small"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}
                  >
                    {resolved.satisfied && <Icon source="check" size="0.9em" />}
                    {resolved.step.title}
                    {!resolved.step.required && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('optional')}</span>}
                  </label>
                  {resolved.step.help && resolved.step.kind !== 'toggle' && (
                    <p className="ui-text-small" style={{ color: 'var(--text-muted)', margin: '0 0 8px' }}>{resolved.step.help}</p>
                  )}
                  {/* A kind with no renderer is reported, never skipped: a step
                      silently missing from the form is an answer the install
                      will demand and nobody was asked for. */}
                  {render
                    ? render({
                        resolved,
                        value: answers[resolved.step.id] ?? resolved.value,
                        onChange: (value) => setAnswer(resolved.step.id, value),
                        onConnect: (key) => router.push(`/integrations?connector=${encodeURIComponent(key)}`),
                        timezoneLabel: t('timezoneFor', { title: resolved.step.title }),
                      })
                    : <div className="ui-text-small" style={{ color: 'var(--coral-bright)' }}>{t('unsupportedStep', { kind: resolved.step.kind })}</div>}
                  {resolved.error && (
                    <div role="alert" className="ui-text-small" style={{ color: 'var(--coral-bright)', marginTop: 6 }}>{resolved.error}</div>
                  )}
                </div>
              );
            })}

            {plan && (
              <button
                type="button"
                className="ui-text-small"
                style={{ ...primaryBtn, opacity: plan.complete && !installing ? 1 : 0.6 }}
                disabled={!plan.complete || installing}
                onClick={install}
              >
                {installing ? t('installing') : t('install')}
              </button>
            )}
          </>
        )}
      </div>
    </SlideOutPanel>
  );
}
