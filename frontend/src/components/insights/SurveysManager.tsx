'use client';

/**
 * Reusable DevEx survey-management surface — template authoring, templates list,
 * campaign launcher, campaigns list and the respond form.
 *
 * Extracted from the retired /surveys page so the SAME component renders inside
 * the DevEx hub's "Surveys" drill-down slide-out (DevexPanelProvider) and can be
 * opened by the Brain. It owns no page chrome (no PageContainer/header) — the
 * slide-out provides the title. Authoring + launching gate on `devex.manage`;
 * everyone can view and respond. i18n stays under the `surveys` namespace.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmError, StatusPill } from '@/components/pm/pmShared';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import {
  devexApi,
  DEVEX_DIMENSIONS, DEVEX_QUESTION_TYPES,
  type DevexTemplate, type DevexCampaign, type DevexQuestion,
  type DevexQuestionType, type DevexDimension, type DevexAnswerMap, type DevexAnswerValue,
} from '@/lib/devexApi';

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.85rem', width: '100%',
};
const selectStyle: React.CSSProperties = { ...inputStyle, width: 'auto', minWidth: 130 };
const btnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--surface-coral-soft, var(--bg-elevated))', color: 'var(--text-primary)',
  fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
};

function newQuestion(): DevexQuestion {
  return { id: `q${Math.random().toString(36).slice(2, 8)}`, type: 'rating', prompt: '', dimension: 'flow' };
}

export function SurveysManager() {
  const t = useTranslations('surveys');
  const { data: templates, error: tErr, reload: reloadTemplates } = usePmData<DevexTemplate[]>(() => devexApi.templates.list(), []);
  const { data: campaigns, error: cErr, reload: reloadCampaigns } = usePmData<DevexCampaign[]>(() => devexApi.campaigns.list(), []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {tErr && <PmError message={tErr} />}
      {cErr && <PmError message={cErr} />}

      <RoleGate capability="devex.manage" variant="block">
        <TemplateAuthor onCreated={reloadTemplates} />
      </RoleGate>

      <TemplatesList templates={templates ?? []} onChanged={reloadTemplates} />

      <RoleGate capability="devex.manage" variant="block">
        <CampaignLauncher templates={templates ?? []} onLaunched={reloadCampaigns} />
      </RoleGate>

      <CampaignsList
        campaigns={campaigns ?? []}
        templates={templates ?? []}
        onChanged={reloadCampaigns}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template authoring
// ---------------------------------------------------------------------------

function TemplateAuthor({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations('surveys');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<DevexQuestion[]>([newQuestion()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const updateQ = (i: number, patch: Partial<DevexQuestion>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  const submit = useCallback(async () => {
    setErr(null);
    const valid = questions.filter((q) => q.prompt.trim());
    if (!name.trim()) { setErr(t('err.nameRequired')); return; }
    if (valid.length === 0) { setErr(t('err.questionRequired')); return; }
    setBusy(true);
    try {
      await devexApi.templates.create({ name: name.trim(), description, questions: valid });
      setName(''); setDescription(''); setQuestions([newQuestion()]);
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [name, description, questions, onCreated, t]);

  return (
    <PmCard title={t('author.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input style={inputStyle} placeholder={t('author.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
        <input style={inputStyle} placeholder={t('author.descPlaceholder')} value={description} onChange={(e) => setDescription(e.target.value)} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {questions.map((q, i) => (
            <div key={q.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                style={{ ...inputStyle, flex: '1 1 240px', width: 'auto' }}
                placeholder={t('author.promptPlaceholder')}
                value={q.prompt}
                onChange={(e) => updateQ(i, { prompt: e.target.value })}
              />
              <Select style={selectStyle} value={q.type} onChange={(e) => updateQ(i, { type: e.target.value as DevexQuestionType })} aria-label={t('author.type')}>
                {DEVEX_QUESTION_TYPES.map((qt) => <option key={qt} value={qt}>{t(`qtype.${qt}`)}</option>)}
              </Select>
              <Select style={selectStyle} value={q.dimension} onChange={(e) => updateQ(i, { dimension: e.target.value as DevexDimension })} aria-label={t('author.dimension')}>
                {DEVEX_DIMENSIONS.map((d) => <option key={d} value={d}>{t(`dim.${d}`)}</option>)}
              </Select>
              {questions.length > 1 && (
                <button style={{ ...btnStyle, background: 'transparent' }} onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>
                  {t('author.removeQuestion')}
                </button>
              )}
            </div>
          ))}
          <button style={{ ...btnStyle, alignSelf: 'flex-start', background: 'transparent' }} onClick={() => setQuestions((qs) => [...qs, newQuestion()])}>
            {t('author.addQuestion')}
          </button>
        </div>

        {err && <span style={{ color: 'var(--danger, #dc2626)', fontSize: '0.82rem' }}>{err}</span>}
        <button style={btnStyle} disabled={busy} onClick={submit}>{busy ? t('saving') : t('author.create')}</button>
      </div>
    </PmCard>
  );
}

// ---------------------------------------------------------------------------
// Templates list
// ---------------------------------------------------------------------------

function TemplatesList({ templates, onChanged }: { templates: DevexTemplate[]; onChanged: () => void }) {
  const t = useTranslations('surveys');
  const remove = async (id: number) => {
    try { await devexApi.templates.remove(id); onChanged(); } catch { /* surfaced via global toast */ }
  };
  return (
    <PmCard title={t('templates.title')}>
      {templates.length === 0 ? (
        <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('templates.empty')}</span>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>{t('templates.name')}</th>
                <th style={thStyle}>{t('templates.questions')}</th>
                <th style={thStyle}>{t('templates.active')}</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => (
                <tr key={tpl.id} style={trStyle}>
                  <td style={tdStyle}>{tpl.name}</td>
                  <td style={tdMutedStyle}>{tpl.questions.length}</td>
                  <td style={tdMutedStyle}>{tpl.isActive ? t('yes') : t('no')}</td>
                  <td style={tdMutedStyle}>
                    <RoleGate capability="devex.manage">
                      <button style={{ ...btnStyle, background: 'transparent' }} onClick={() => remove(tpl.id)}>{t('templates.delete')}</button>
                    </RoleGate>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PmCard>
  );
}

// ---------------------------------------------------------------------------
// Campaign launcher
// ---------------------------------------------------------------------------

function CampaignLauncher({ templates, onLaunched }: { templates: DevexTemplate[]; onLaunched: () => void }) {
  const t = useTranslations('surveys');
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  const [periodMonth, setPeriodMonth] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setErr(null);
    if (!title.trim()) { setErr(t('err.titleRequired')); return; }
    setBusy(true);
    try {
      await devexApi.campaigns.create({
        title: title.trim(),
        templateId: templateId ? Number(templateId) : null,
        periodMonth: periodMonth || null,
        anonymous,
      });
      setTitle(''); setTemplateId(''); setPeriodMonth('');
      onLaunched();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [title, templateId, periodMonth, anonymous, onLaunched, t]);

  return (
    <PmCard title={t('launch.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input style={inputStyle} placeholder={t('launch.titlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select style={selectStyle} value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label={t('launch.template')}>
            <option value="">{t('launch.noTemplate')}</option>
            {templates.map((tpl) => <option key={tpl.id} value={String(tpl.id)}>{tpl.name}</option>)}
          </Select>
          <input style={{ ...inputStyle, width: 'auto' }} placeholder="YYYY-MM" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            {t('launch.anonymous')}
          </label>
        </div>
        {err && <span style={{ color: 'var(--danger, #dc2626)', fontSize: '0.82rem' }}>{err}</span>}
        <button style={btnStyle} disabled={busy} onClick={submit}>{busy ? t('saving') : t('launch.create')}</button>
      </div>
    </PmCard>
  );
}

// ---------------------------------------------------------------------------
// Campaigns list + respond
// ---------------------------------------------------------------------------

function CampaignsList({
  campaigns, templates, onChanged,
}: { campaigns: DevexCampaign[]; templates: DevexTemplate[]; onChanged: () => void }) {
  const t = useTranslations('surveys');
  const [respondTo, setRespondTo] = useState<number | null>(null);

  const close = async (id: number) => {
    try { await devexApi.campaigns.update(id, { status: 'closed' }); onChanged(); } catch { /* toast */ }
  };

  return (
    <PmCard title={t('campaigns.title')}>
      {campaigns.length === 0 ? (
        <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('campaigns.empty')}</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('campaigns.name')}</th>
                  <th style={thStyle}>{t('campaigns.period')}</th>
                  <th style={thStyle}>{t('campaigns.status')}</th>
                  <th style={thStyle}>{t('campaigns.responses')}</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} style={trStyle}>
                    <td style={tdStyle}>{c.title}{c.anonymous ? ` · ${t('campaigns.anon')}` : ''}</td>
                    <td style={tdMutedStyle}>{c.periodMonth ?? '—'}</td>
                    <td style={tdMutedStyle}><StatusPill value={c.status === 'open' ? 'now' : 'later'} /></td>
                    <td style={tdMutedStyle}>{c.responseCount ?? 0}</td>
                    <td style={tdMutedStyle}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {c.status === 'open' && (
                          <button style={{ ...btnStyle, background: 'transparent' }} onClick={() => setRespondTo(respondTo === c.id ? null : c.id)}>
                            {t('campaigns.respond')}
                          </button>
                        )}
                        {c.status === 'open' && (
                          <RoleGate capability="devex.manage">
                            <button style={{ ...btnStyle, background: 'transparent' }} onClick={() => close(c.id)}>{t('campaigns.close')}</button>
                          </RoleGate>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {respondTo != null && (() => {
            const campaign = campaigns.find((c) => c.id === respondTo);
            const template = templates.find((tpl) => tpl.id === campaign?.templateId);
            return (
              <RespondForm
                key={respondTo}
                campaignId={respondTo}
                questions={template?.questions ?? []}
                onDone={() => { setRespondTo(null); onChanged(); }}
              />
            );
          })()}
        </div>
      )}
    </PmCard>
  );
}

function RespondForm({
  campaignId, questions, onDone,
}: { campaignId: number; questions: DevexQuestion[]; onDone: () => void }) {
  const t = useTranslations('surveys');
  const [answers, setAnswers] = useState<DevexAnswerMap>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const setA = (id: string, v: DevexAnswerValue) => setAnswers((a) => ({ ...a, [id]: v }));

  const submit = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      await devexApi.respond(campaignId, answers);
      setDone(true);
      setTimeout(onDone, 800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [campaignId, answers, onDone]);

  if (done) return <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('respond.thanks')}</div>;

  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <strong style={{ fontSize: '0.9rem' }}>{t('respond.title')}</strong>
      {questions.length === 0 && <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t('respond.noQuestions')}</span>}
      {questions.map((q) => (
        <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: '0.85rem' }}>{q.prompt} <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({t(`dim.${q.dimension}`)})</span></label>
          {q.type === 'rating' && (
            <Select style={selectStyle} value={String(answers[q.id] ?? '')} onChange={(e) => setA(q.id, Number(e.target.value))} aria-label={q.prompt}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{n}</option>)}
            </Select>
          )}
          {q.type === 'nps' && (
            <Select style={selectStyle} value={String(answers[q.id] ?? '')} onChange={(e) => setA(q.id, Number(e.target.value))} aria-label={q.prompt}>
              <option value="">—</option>
              {Array.from({ length: 11 }, (_, n) => <option key={n} value={String(n)}>{n}</option>)}
            </Select>
          )}
          {q.type === 'boolean' && (
            <Select style={selectStyle} value={answers[q.id] === undefined ? '' : String(answers[q.id])} onChange={(e) => setA(q.id, e.target.value === 'true')} aria-label={q.prompt}>
              <option value="">—</option>
              <option value="true">{t('yes')}</option>
              <option value="false">{t('no')}</option>
            </Select>
          )}
          {q.type === 'text' && (
            <input style={inputStyle} value={String(answers[q.id] ?? '')} onChange={(e) => setA(q.id, e.target.value)} />
          )}
        </div>
      ))}
      {err && <span style={{ color: 'var(--danger, #dc2626)', fontSize: '0.82rem' }}>{err}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={btnStyle} disabled={busy} onClick={submit}>{busy ? t('saving') : t('respond.submit')}</button>
        <button style={{ ...btnStyle, background: 'transparent' }} onClick={onDone}>{t('respond.cancel')}</button>
      </div>
    </div>
  );
}
