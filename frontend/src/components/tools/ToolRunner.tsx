'use client';

/**
 * THE diagnostic runner — one component, two surfaces (PRD 21 §11.4.5).
 *
 * It used to live in `app/tools/[id]/`, which made the canvas import a ROUTE
 * folder to render an object on the board. A shared component that two layers
 * consume belongs in `components/`; a route folder is a presentation leaf, not
 * a library.
 *
 * `surface` is the ONE field that decides its chrome, rather than a `embedded`
 * boolean that meant three different things at once:
 *
 *   `reference` — inside the tool's reference page (public URL signed out, a
 *                 panel over the board signed in). The PAGE owns the hero, the
 *                 anchors and the returning-visitor banner; the runner owns the
 *                 questions, the run and the result.
 *   `canvas`    — inside a Canvas object. Needs React Flow's `nodrag nowheel`
 *                 escape so typing an answer does not pan the board, and it
 *                 restates the tool's own `about` line because the object has no
 *                 hero above it.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { toolsApi } from '@/lib/builderforceApi';
import { ToolResultView } from '@/components/tools/ToolResultView';
import { AnalyzerRunner } from '@/components/tools/AnalyzerRunner';
import { DataDrivenPanel } from '@/components/tools/DataDrivenPanel';
import { trackToolRun } from '@/lib/marketingApi';
import { defaultInput, answersComplete, type ToolDefinition, type ToolResult } from '@/lib/tools';
import { getStoredUser, getStoredTenantToken } from '@/lib/auth';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';

const card: React.CSSProperties = { background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 18 };
const fieldInput: React.CSSProperties = {
  padding: '9px 12px', fontSize: 'var(--font-size-body)', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', width: '100%',
};
const btnPrimary: React.CSSProperties = {
  padding: '10px 20px', fontSize: 'var(--font-size-body)', fontWeight: 700, borderRadius: 'var(--radius-lg)', border: 'none',
  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: 'var(--text-on-accent)', cursor: 'pointer', textDecoration: 'none',
};
const btnSubtle: React.CSSProperties = {
  padding: '9px 16px', fontSize: 'var(--font-size-small)', fontWeight: 600, borderRadius: 'var(--radius-md)',
  background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', cursor: 'pointer', whiteSpace: 'nowrap',
};

export type ToolRunnerSurface = 'reference' | 'canvas';

export interface ToolRunnerProps {
  toolId: string;
  /** Which chrome this instance wears. Defaults to the reference page. */
  surface?: ToolRunnerSurface;
  initialInput?: Record<string, number>;
  initialResult?: ToolResult | null;
  onInputChange?: (input: Record<string, number>) => void;
  onRunComplete?: (input: Record<string, number>, result: ToolResult) => void;
  /** Told the tool's own name/about once loaded, so a host (the reference page)
   *  can title itself from the API catalog instead of restating it. */
  onDefinitionLoad?: (definition: ToolDefinition) => void;
}

export default function ToolRunner({
  toolId, surface = 'reference', initialInput, initialResult = null,
  onInputChange, onRunComplete, onDefinitionLoad,
}: ToolRunnerProps) {
  const t = useTranslations('tools');
  const searchParams = useSearchParams();
  // Attribute the run to a project: the global TopBar scope param `?project=` wins,
  // the legacy `?projectId=` is still honoured for old links, and when neither is
  // present we fall back to the global project scope (one picker for the whole
  // app — see ProjectScopeContext). `useOptionalProjectScope` is null outside the
  // app shell (the public tool page), where the run is simply tenant-attributed.
  const scope = useOptionalProjectScope();
  const projectIdParam = searchParams.get('project') ?? searchParams.get('projectId');
  const projectId = projectIdParam != null && /^\d+$/.test(projectIdParam)
    ? Number(projectIdParam)
    : (scope?.currentProjectId ?? null);
  const [def, setDef] = useState<ToolDefinition | null>(null);
  const [input, setInput] = useState<Record<string, number>>(initialInput ?? {});
  const [result, setResult] = useState<ToolResult | null>(initialResult);
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState('');
  const [mode, setMode] = useState<'self' | 'data'>('self');

  const hasWorkspace = !!getStoredTenantToken();
  const isAuthed = !!getStoredUser();
  const embedded = surface === 'canvas';

  useEffect(() => {
    let active = true;
    toolsApi.get(toolId)
      .then((d) => {
        if (!active) return;
        setDef(d);
        setInput(initialInput && Object.keys(initialInput).length ? initialInput : defaultInput(d));
        onDefinitionLoad?.(d);
      })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
    // The definition is keyed by the tool alone. `initialInput` / `onDefinitionLoad`
    // are deliberately out: both change identity on every host render, and a
    // definition fetch that re-runs per render is what made the tool card sit on
    // "Loading…" forever while the board around it moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId]);

  const setVal = (id: string, v: number) => {
    const next = { ...input, [id]: v };
    setInput(next);
    onInputChange?.(next);
    setResult(null);
    setSaveState('idle');
  };

  const run = async () => {
    if (!def) return;
    setComputing(true); setError(null);
    try {
      const res = await toolsApi.compute(toolId, input);
      setResult(res);
      onRunComplete?.(input, res);
      // Track anonymous runs as marketing leads so a returning visitor can re-see
      // their result and we can target them with a sign-up. Authed users are known.
      if (!isAuthed) trackToolRun(toolId, input, res);
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

  if (error && !def) return <div role="alert" style={card}>{t('loadError')}: {error}</div>;
  if (!def) return <div role="status" style={{ color: 'var(--muted)' }}>{t('loading')}</div>;

  // An analyzer reads documents rather than scoring answers, so its form and its
  // endpoint differ — but only here. Every caller still asks for a tool by id and
  // gets the right runner, which is what keeps the canvas and the reference page
  // from branching on kind themselves.
  if (def.kind === 'analyzer') {
    return (
      <AnalyzerRunner
        definition={def}
        embedded={embedded}
        onRunComplete={(_, res) => onRunComplete?.({}, res)}
      />
    );
  }

  const canRun = answersComplete(def, input);
  const answeredAny = Object.keys(input).length > 0;

  return (
    <div className={embedded ? 'nodrag nowheel' : undefined}>
      {embedded && <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--canvas-ink-soft)', margin: '0 0 14px' }}>{def.about}</p>}

      {projectId != null && !embedded && (
        <p style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--accent)', margin: '0 0 12px' }}>{t('scoringProject')}</p>
      )}

      {/* Mode toggle — only for tools that also have a "from your data" provider */}
      {def.hasDataDriven && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 18, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden', maxWidth: 380 }}>
          {(['self', 'data'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                flex: 1, padding: '8px 12px', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer', border: 'none',
                background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? 'var(--text-on-accent)' : 'var(--text-strong)',
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
              <label style={{ display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
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
              {f.help && <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--muted)', marginTop: 4 }}>{f.help}</div>}
            </div>
          ))}
        </div>
      ) : def.kind === 'quiz' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {def.questions.map((q) => (
            <section key={q.id} style={card}>
              <div style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--coral-bright)', marginBottom: 4 }}>{q.dimension}</div>
              <h3 style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 12px' }}>{q.text}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {q.options.map((o) => {
                  const active = input[q.id] === o.level;
                  return (
                    <button
                      key={o.level} type="button" onClick={() => setVal(q.id, o.level)}
                      aria-pressed={active}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', width: '100%',
                        padding: '12px 14px', fontSize: 'var(--font-size-small)', lineHeight: 1.45, borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
                        background: active ? 'var(--accent)' : 'var(--bg-elevated)',
                        color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                      }}
                    >
                      <span aria-hidden style={{
                        flexShrink: 0, marginTop: 2, width: 16, height: 16, borderRadius: '50%',
                        // The dot sits ON the accent-filled row when selected, so its
                        // ring and centre are the on-accent ink, not a raw white.
                        border: `2px solid ${active ? 'var(--text-on-accent)' : 'var(--border-subtle)'}`,
                        background: active ? 'var(--text-on-accent)' : 'transparent', boxShadow: active ? 'inset 0 0 0 3px var(--accent)' : 'none',
                      }} />
                      <span>{o.text}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ ...card, padding: '12px 16px' }}>
            <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-strong)', marginBottom: 8 }}>{t('scaleHint')}</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {def.scale.map((sc) => (
                <div key={sc.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22,
                    borderRadius: 'var(--radius-sm)', fontWeight: 700, fontSize: 'var(--font-size-eyebrow)', background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)', color: 'var(--text-strong)',
                  }}>{sc.value}</span>
                  {sc.label}
                </div>
              ))}
            </div>
          </div>
          {def.sections.map((s) => (
            <section key={s.key} style={card}>
              <h3 style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 2px' }}>{s.name}</h3>
              <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--muted)', margin: '0 0 12px' }}>{s.description}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {s.questions.map((q) => (
                  <div key={q.id}>
                    <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)', marginBottom: 6 }}>{q.text}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {def.scale.map((sc) => {
                        const active = input[q.id] === sc.value;
                        return (
                          <button
                            key={sc.value} type="button" onClick={() => setVal(q.id, sc.value)} title={`${sc.value} — ${sc.label}`}
                            style={{
                              padding: '6px 10px', fontSize: 'var(--font-size-small)', fontWeight: 600, borderRadius: 'var(--radius-md)', cursor: 'pointer',
                              border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
                              background: active ? 'var(--accent)' : 'var(--bg-elevated)', color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
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
        <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--muted)' }}>
          {def.kind !== 'calculator' && !canRun && answeredAny ? t('answerAll') : ''}
        </div>
        <button type="button" disabled={!canRun || computing} onClick={run} style={{ ...btnPrimary, opacity: !canRun || computing ? 0.6 : 1, cursor: !canRun || computing ? 'not-allowed' : 'pointer' }}>
          {computing ? t('computing') : t('run')}
        </button>
      </div>

      {error && def && <div style={{ color: 'var(--error-text)', marginTop: 12 }}>{error}</div>}

      {/* Result + execute gate */}
      {result && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 800, color: 'var(--text-strong)', margin: '0 0 14px' }}>{t('yourResult')}</h3>
          <ToolResultView result={result} />

          <div style={{ ...card, marginTop: 18, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            {hasWorkspace ? (
              <>
                <div>
                  <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-strong)' }}>{t('saveTitle')}</div>
                  <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('saveDesc')}</div>
                  {saveState !== 'idle' && <div style={{ fontSize: 'var(--font-size-small)', marginTop: 6, color: saveState === 'error' ? 'var(--error-text)' : 'var(--success)' }}>{saveMsg}</div>}
                </div>
                <button type="button" onClick={save} disabled={saveState === 'saving'} style={btnSubtle}>
                  {saveState === 'saving' ? t('saving') : saveState === 'saved' ? t('savedShort') : t('saveResult')}
                </button>
              </>
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-strong)' }}>{t('ctaTitle')}</div>
                  <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('ctaDesc')}</div>
                </div>
                <Link href={`/register?next=/tools/${toolId}`} style={btnPrimary}>{t('createAccount')} →</Link>
              </>
            )}
          </div>
          {isAuthed && !hasWorkspace && <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--muted)', marginTop: 10 }}>{t('needWorkspace')}</p>}
        </div>
      )}
      </>
      )}
    </div>
  );
}
