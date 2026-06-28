'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { toolsApi } from '@/lib/builderforceApi';
import { ToolResultView } from '@/components/tools/ToolResultView';
import { DataDrivenPanel } from '@/components/tools/DataDrivenPanel';
import { defaultInput, questionnaireComplete, type ToolDefinition, type ToolResult } from '@/lib/tools';
import { getStoredUser, getStoredTenantToken } from '@/lib/auth';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';

const wrap: React.CSSProperties = { maxWidth: 820, margin: '0 auto', padding: '32px 20px' };
const card: React.CSSProperties = { background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18 };
const fieldInput: React.CSSProperties = {
  padding: '9px 12px', fontSize: 14, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 8, color: 'var(--text-primary)', width: '100%',
};
const btnPrimary: React.CSSProperties = {
  padding: '10px 20px', fontSize: 14, fontWeight: 700, borderRadius: 10, border: 'none',
  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', cursor: 'pointer', textDecoration: 'none',
};
const btnSubtle: React.CSSProperties = {
  padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8,
  background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', cursor: 'pointer', whiteSpace: 'nowrap',
};

export default function ToolRunnerClient({ toolId }: { toolId: string }) {
  const t = useTranslations('tools');
  const searchParams = useSearchParams();
  // Attribute the run to a project: the global TopBar scope param `?project=` wins,
  // the legacy `?projectId=` is still honoured for old links, and when neither is
  // present we fall back to the global project scope (one picker for the whole
  // app — see ProjectScopeContext). `useOptionalProjectScope` is null outside the
  // app shell (the public tool runner), where the run is simply tenant-attributed.
  const scope = useOptionalProjectScope();
  const projectIdParam = searchParams.get('project') ?? searchParams.get('projectId');
  const projectId = projectIdParam != null && /^\d+$/.test(projectIdParam)
    ? Number(projectIdParam)
    : (scope?.currentProjectId ?? null);
  const [def, setDef] = useState<ToolDefinition | null>(null);
  const [input, setInput] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState('');
  const [mode, setMode] = useState<'self' | 'data'>('self');

  const hasWorkspace = !!getStoredTenantToken();
  const isAuthed = !!getStoredUser();

  useEffect(() => {
    toolsApi.get(toolId)
      .then((d) => { setDef(d); setInput(defaultInput(d)); })
      .catch((e: Error) => setError(e.message));
  }, [toolId]);

  const setVal = (id: string, v: number) => { setInput((s) => ({ ...s, [id]: v })); setResult(null); setSaveState('idle'); };

  const run = async () => {
    if (!def) return;
    setComputing(true); setError(null);
    try {
      setResult(await toolsApi.compute(toolId, input));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run');
    } finally {
      setComputing(false);
    }
  };

  const save = async () => {
    setSaveState('saving');
    try {
      await toolsApi.save(toolId, input, projectId);
      setSaveState('saved'); setSaveMsg(projectId != null ? t('savedProject') : t('saved'));
    } catch (e) {
      setSaveState('error'); setSaveMsg(e instanceof Error ? e.message : t('saveFailed'));
    }
  };

  if (error && !def) return <div style={wrap}><div style={card}>{t('loadError')}: {error}</div></div>;
  if (!def) return <div style={wrap}><div style={{ color: 'var(--muted)' }}>{t('loading')}</div></div>;

  const canRun = def.kind === 'calculator' || questionnaireComplete(def, input);
  const answeredAny = Object.keys(input).length > 0;

  return (
    <div style={wrap}>
      <header style={{ marginBottom: 20 }}>
        <Link href="/tools" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>← {t('allTools')}</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 4px' }}>
          <span style={{ fontSize: 26 }}>{def.icon}</span>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-strong)', margin: 0 }}>{def.name}</h1>
        </div>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--coral-bright)', margin: '4px 0' }}>
          {t('freeNoLogin')}
        </p>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 680 }}>{def.about}</p>
        {projectId != null && (
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', margin: '6px 0 0' }}>{t('scoringProject')}</p>
        )}
      </header>

      {/* Mode toggle — only for tools that also have a "from your data" provider */}
      {def.hasDataDriven && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 18, border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden', maxWidth: 380 }}>
          {(['self', 'data'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                flex: 1, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? '#fff' : 'var(--text-strong)',
              }}
            >
              {m === 'self' ? t('modeSelf') : t('modeData')}
            </button>
          ))}
        </div>
      )}

      {mode === 'data' && def.hasDataDriven ? (
        <DataDrivenPanel toolId={toolId} projectId={projectId} />
      ) : (
      <>
      {/* Inputs */}
      {def.kind === 'calculator' ? (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {def.inputs.map((f) => (
            <div key={f.id}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                {f.label}{f.unit ? ` (${f.unit})` : ''}
              </label>
              {f.type === 'select' && f.options ? (
                <Select value={String(input[f.id] ?? f.default)} onChange={(e) => setVal(f.id, Number(e.target.value))} style={fieldInput}>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : (
                <input
                  type="number" inputMode="decimal" style={fieldInput}
                  value={input[f.id] ?? f.default}
                  min={f.min} max={f.max} step={f.step ?? 1}
                  onChange={(e) => setVal(f.id, e.target.value === '' ? 0 : Number(e.target.value))}
                />
              )}
              {f.help && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{f.help}</div>}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ ...card, padding: '12px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 8 }}>{t('scaleHint')}</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {def.scale.map((sc) => (
                <div key={sc.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22,
                    borderRadius: 6, fontWeight: 700, fontSize: 11, background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)', color: 'var(--text-strong)',
                  }}>{sc.value}</span>
                  {sc.label}
                </div>
              ))}
            </div>
          </div>
          {def.sections.map((s) => (
            <section key={s.key} style={card}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 2px' }}>{s.name}</h2>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>{s.description}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {s.questions.map((q) => (
                  <div key={q.id}>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 6 }}>{q.text}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {def.scale.map((sc) => {
                        const active = input[q.id] === sc.value;
                        return (
                          <button
                            key={sc.value} type="button" onClick={() => setVal(q.id, sc.value)} title={`${sc.value} — ${sc.label}`}
                            style={{
                              padding: '6px 10px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                              border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
                              background: active ? 'var(--accent)' : 'var(--bg-elevated)', color: active ? '#fff' : 'var(--text-secondary)',
                            }}
                          >
                            {sc.value}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Run */}
      <div style={{ ...card, marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {def.kind === 'questionnaire' && !canRun && answeredAny ? t('answerAll') : ''}
        </div>
        <button type="button" disabled={!canRun || computing} onClick={run} style={{ ...btnPrimary, opacity: !canRun || computing ? 0.6 : 1, cursor: !canRun || computing ? 'not-allowed' : 'pointer' }}>
          {computing ? t('computing') : t('run')}
        </button>
      </div>

      {error && def && <div style={{ color: 'var(--error-text)', marginTop: 12 }}>{error}</div>}

      {/* Result + execute gate */}
      {result && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-strong)', margin: '0 0 14px' }}>{t('yourResult')}</h2>
          <ToolResultView result={result} />

          <div style={{ ...card, marginTop: 18, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            {hasWorkspace ? (
              <>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)' }}>{t('saveTitle')}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('saveDesc')}</div>
                  {saveState !== 'idle' && <div style={{ fontSize: 12, marginTop: 6, color: saveState === 'error' ? 'var(--error-text)' : '#22c55e' }}>{saveMsg}</div>}
                </div>
                <button type="button" onClick={save} disabled={saveState === 'saving'} style={btnSubtle}>
                  {saveState === 'saving' ? t('saving') : saveState === 'saved' ? t('savedShort') : t('saveResult')}
                </button>
              </>
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)' }}>{t('ctaTitle')}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('ctaDesc')}</div>
                </div>
                <Link href={`/register?next=/tools/${toolId}`} style={btnPrimary}>{t('createAccount')} →</Link>
              </>
            )}
          </div>
          {isAuthed && !hasWorkspace && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>{t('needWorkspace')}</p>}
        </div>
      )}
      </>
      )}
    </div>
  );
}
