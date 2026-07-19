/**
 * <EvermindConsole> — the per-project Evermind inspect-and-train surface, rendered
 * identically on the web app (embedded in the IDE agent panel) and in the VS Code
 * sidebar webview. Presentational + self-managing: it loads through the injected
 * {@link EvermindConsoleAdapter}, refreshes on a light poll, and drives the
 * manager-gated training controls (seed / inference / learning mode / teacher),
 * the "teach from a transcript" producer path, a "learn now" flush, and the
 * recent-contributions inspection list. Themed via cascading `--bf-*` CSS variables
 * so it reads natively in both light and dark, on the web and in the editor.
 *
 * All colours resolve through the injected host tokens; the write controls are
 * disabled (not hidden) when `canManage` is false, mirroring the web RoleGate.
 * See [[evermind-learning-architecture]].
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_EVERMIND_LABELS,
  type EvermindConsoleAdapter,
  type EvermindConsoleData,
  type EvermindConsoleLabels,
  type EvermindEvalPoint,
  type EvermindRecentEntry,
  type EvermindSeedModel,
  type EvermindTeacherOptions,
  type EvermindValidateResult,
} from './types';
import { evermindLearnedStatus } from './learnedStatus';

export interface EvermindConsoleProps {
  adapter: EvermindConsoleAdapter;
  /** Whether the viewer can change settings (manager). Controls are disabled, not hidden. */
  canManage: boolean;
  /** i18n overrides; unspecified keys fall back to English defaults. */
  labels?: Partial<EvermindConsoleLabels>;
  /** Poll interval (ms) for the live pending/recent readout. 0 disables. Default 20s. */
  refreshMs?: number;
  /** Name of the project this console is scoped to. Shown in the header so the same
   *  panel on two surfaces (web tab vs VS Code sidebar) never looks like contradictory
   *  states for "the same project" when they are in fact different projects. */
  projectName?: string;
  /** Show the "Recently learned" list. Default true; a host that renders its own
   *  learnings surface (e.g. the web Studio's region-filterable panel) passes false. */
  showRecent?: boolean;
  /** Show the inline `↻` refresh button in the header. Default true. A host that
   *  drives refresh from its OWN chrome (e.g. the VS Code sidebar view's title bar)
   *  passes false and bumps {@link refreshSignal} instead, so the control lives in
   *  the one place that host expects it rather than duplicated inside the card. */
  showHeaderRefresh?: boolean;
  /** A monotonic counter a host bumps to trigger an in-place reload from OUTSIDE the
   *  console (e.g. a title-bar refresh action). Each new value re-fetches without the
   *  loading flash — the same reload the inline `↻` runs. Undefined/0 = no external refresh. */
  refreshSignal?: number;
  /** Called whenever a Validate runs (or is cleared, with null) — lets a host lift
   *  the recall result to a companion surface (e.g. highlight the matched memories
   *  on the web Studio's Knowledge Map). The console also renders the result inline. */
  onValidate?: (result: EvermindValidateResult | null) => void;
}

/* Cascading theme tokens: evermind-namespaced → host app tokens → VS Code tokens →
   a legible literal, so the console themes in every host without per-host CSS. */
const C = {
  surface: 'var(--bf-ev-surface, var(--bg-surface, var(--bf-surface, var(--vscode-editorWidget-background, transparent))))',
  surface2: 'var(--bf-ev-surface-2, var(--bg-elevated, var(--bf-surface-2, var(--vscode-textBlockQuote-background, rgba(148,163,184,0.08)))))',
  border: 'var(--bf-ev-border, var(--border-subtle, var(--bf-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))))',
  text: 'var(--bf-ev-text, var(--text-primary, var(--bf-text, inherit)))',
  text2: 'var(--bf-ev-text-2, var(--text-secondary, var(--bf-text-muted, #6b7280)))',
  accent: 'var(--bf-ev-accent, var(--coral-bright, var(--accent, var(--bf-accent, #ff6b5e))))',
  danger: 'var(--bf-ev-danger, var(--danger-text, #d9534f))',
};

export function EvermindConsole({ adapter, canManage, labels, refreshMs = 20_000, projectName, showRecent = true, showHeaderRefresh = true, refreshSignal, onValidate }: EvermindConsoleProps) {
  const t = useMemo<EvermindConsoleLabels>(() => ({ ...DEFAULT_EVERMIND_LABELS, ...(labels ?? {}) }), [labels]);

  const [data, setData] = useState<EvermindConsoleData | null>(null);
  const [seedModels, setSeedModels] = useState<EvermindSeedModel[]>([]);
  const [teacherOpts, setTeacherOpts] = useState<EvermindTeacherOptions | null>(null);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [teachPrompt, setTeachPrompt] = useState('');
  const [teachText, setTeachText] = useState('');
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<EvermindValidateResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // A load FAILURE is distinct from a genuinely-unseeded model: without this, a 404 /
  // expired token / wrong project id would fall through to `seeded === false` and render
  // the exact same "Not set up" UI as a real unseeded project — actively misleading.
  const [loadFailed, setLoadFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const d = await adapter.loadData();
      setData(d);
      setLoadFailed(false);
    } catch {
      setData(null);
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [adapter]);

  // Initial load + adapter change (project switch re-provisions the adapter host-side).
  useEffect(() => { setLoaded(false); void reload(); }, [reload]);

  // Manager-only ancillary lists (seed candidates + teacher options). Fetched once
  // per adapter — a non-manager never needs them.
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void adapter.loadSeedModels().then((m) => { if (!cancelled) { setSeedModels(m); setSelectedSlug((cur) => cur || (m[0]?.slug ?? '')); } }).catch(() => {});
    void adapter.loadTeacherOptions().then((o) => { if (!cancelled) setTeacherOpts(o); }).catch(() => {});
    return () => { cancelled = true; };
  }, [adapter, canManage]);

  // Light poll so pending/recent stay live while learning happens. The read endpoint
  // is server-cached, so this is cheap; paused while an action is in flight.
  useEffect(() => {
    if (!refreshMs) return;
    const id = setInterval(() => { if (!busy) void reload(); }, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, busy, reload]);

  // Host-driven refresh: when a host bumps `refreshSignal` (e.g. a VS Code title-bar
  // action), reload in place — the same effect as the inline `↻`, no loading flash.
  // A ref tracks the last-handled value so the initial mount (and adapter-swap reload
  // churn) never double-fires: only a genuinely NEW value triggers a reload.
  const lastRefreshSignal = useRef<number | undefined>(refreshSignal);
  useEffect(() => {
    if (refreshSignal == null || refreshSignal === lastRefreshSignal.current) return;
    lastRefreshSignal.current = refreshSignal;
    void reload();
  }, [refreshSignal, reload]);

  // Validate: preview which learned memories would answer a candidate task. Read-only
  // — never teaches. Stores the result for the inline list AND lifts it to the host
  // (onValidate) so a companion surface can highlight the matched memories.
  const runValidate = useCallback(async (prompt: string) => {
    const task = prompt.trim();
    if (task.length < 3) return;
    setValidating(true); setError(null); setNotice(null);
    try {
      const result = await adapter.validate(task);
      setValidateResult(result);
      onValidate?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setValidating(false);
    }
  }, [adapter, onValidate, t.errorGeneric]);

  const clearValidate = useCallback(() => { setValidateResult(null); onValidate?.(null); }, [onValidate]);

  const run = useCallback(async (op: () => Promise<void>, successNotice?: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await op();
      await reload();
      if (successNotice) setNotice(successNotice);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }, [reload, t.errorGeneric]);

  if (!loaded) return <Section aria-busy><p style={{ margin: 0, color: C.text2, fontSize: '0.82rem' }}>{t.loading}</p></Section>;

  const seeded = !!data?.seeded;
  const frozen = data?.mode === 'offline-frozen';

  // The scoped project name — rendered next to the title so the panel always says WHICH
  // project's Evermind this is (the web tab and the VS Code sidebar can be on different
  // projects at once). Trimmed to avoid an empty pill from a whitespace name.
  const scopeName = projectName?.trim();
  const Header = (
    <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span aria-hidden style={{ fontSize: '1.05rem' }}>🧠</span>
      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: C.text }}>{t.title}</h3>
      {scopeName && <span style={{ fontSize: '0.8rem', color: C.text2 }} title={scopeName}>· {scopeName}</span>}
      {!loadFailed && <span style={pill(seeded)}>{seeded ? t.statusSeeded(data?.version ?? 0) : t.statusUnseeded}</span>}
      {!loadFailed && seeded && <RegressionChip t={t} evalPoint={data?.eval ?? null} />}
      {showHeaderRefresh && (
        <button type="button" onClick={() => void reload()} disabled={busy} style={ghostBtn} title={t.refresh} aria-label={t.refresh}>↻</button>
      )}
    </header>
  );

  // Load failed — surface it with a retry instead of masquerading as "Not set up".
  if (loadFailed) {
    return (
      <Section aria-label={t.title}>
        {Header}
        <p style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.5, color: C.danger }} role="alert">{t.errorGeneric}</p>
        <button type="button" onClick={() => void reload()} disabled={busy} style={primaryBtn(busy)}>{t.refresh}</button>
      </Section>
    );
  }

  return (
    <Section aria-label={t.title}>
      {Header}

      <p style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.5, color: C.text2 }}>{t.description}</p>
      {!canManage && <p style={{ margin: 0, fontSize: '0.72rem', color: C.text2, fontStyle: 'italic' }}>{t.managerOnlyHint}</p>}

      {!seeded ? (
        <SeedControls
          t={t} canManage={canManage} busy={busy} models={seedModels}
          selectedSlug={selectedSlug} onSelect={setSelectedSlug}
          onSeed={() => selectedSlug && run(() => adapter.seedFromModel(selectedSlug))}
        />
      ) : (
        <>
          <StatRow t={t} data={data!} />

          <ToggleRow
            label={t.inferenceLabel} hint={t.inferenceHint}
            on={!!data?.inferenceEnabled} onText={t.on} offText={t.off}
            disabled={!canManage || busy}
            onToggle={() => run(() => adapter.setInference(!data?.inferenceEnabled))}
          />
          <ToggleRow
            label={t.learningLabel} hint={t.learningHint}
            on={!frozen} onText={t.connected} offText={t.frozen}
            disabled={!canManage || busy}
            onToggle={() => run(() => adapter.setMode(frozen ? 'connected' : 'offline-frozen'))}
          />

          <TeacherPicker
            t={t} canManage={canManage} busy={busy} opts={teacherOpts}
            value={data?.teacherModel ?? ''}
            onChange={(m) => run(() => adapter.setTeacher(m || null))}
          />

          <TeachBox
            t={t} busy={busy} validating={validating} teacherModel={data?.teacherModel ?? ''}
            prompt={teachPrompt} text={teachText}
            onPrompt={setTeachPrompt} onText={setTeachText}
            onTeach={() => run(
              async () => {
                const task = teachPrompt.trim();
                const body = teachText.trim();
                // With a teacher pinned you teach a TASK: the teacher answers it and the
                // model learns (task → ideal answer), so send the task as both text + prompt.
                if (data?.teacherModel && body.length < 20 && task.length >= 20) {
                  await adapter.teach(task, task);
                } else {
                  await adapter.teach(body, task || undefined);
                }
                setTeachText(''); setTeachPrompt('');
              },
              t.taught,
            )}
            // Validate the SAME task the user would teach: the pinned-teacher task prompt,
            // else the transcript's task prompt, else the transcript body itself.
            onValidate={() => runValidate(data?.teacherModel ? teachPrompt : (teachPrompt.trim() || teachText))}
          />

          {validateResult && (
            <ValidateResults t={t} result={validateResult} onClear={clearValidate} />
          )}

          {canManage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={busy || frozen}
                onClick={() => run(async () => {
                  const r = await adapter.flush();
                  setNotice(r.merged > 0 ? t.flushedN(r.merged, r.version) : t.flushedNone);
                }, undefined)}
                style={primaryBtn(busy || frozen)}
              >
                {busy ? t.flushing : t.flushCta}
              </button>
              {(data?.pending ?? 0) > 0 && (
                <span style={{ fontSize: '0.74rem', color: C.text2 }}>{t.pendingLabel}: {data?.pending}</span>
              )}
            </div>
          )}

          {/* Import from builderforce-memory — only when the host implements the file
              op (VS Code). The shared component decides its own visibility, so the web
              app (no adapter.importMemory) simply never renders it. */}
          {canManage && adapter.importMemory && (
            <ImportBox
              t={t} busy={busy} frozen={frozen}
              onImport={() => run(async () => {
                const report = await adapter.importMemory!();
                if (!report) return; // user cancelled the picker — no notice
                setNotice(
                  report.absorbed > 0
                    ? t.importDone(report.absorbed, report.version, report.compacted, (report.bytesSaved / 1024).toFixed(1))
                    : t.importNothing,
                );
              })}
            />
          )}

          {showRecent && <RecentList t={t} entries={data?.recent ?? []} />}
        </>
      )}

      {notice && <p style={{ margin: 0, fontSize: '0.74rem', color: C.accent }} role="status">{notice}</p>}
      {error && <p style={{ margin: 0, fontSize: '0.76rem', color: C.danger }} role="alert">{error}</p>}
    </Section>
  );
}

/* ── Sub-sections ─────────────────────────────────────────────────────────── */

/**
 * The automatic pre/post regression chip beside the status pill: ▲ when the latest
 * merge LOWERED held-out loss on the project's prior taught examples (improved /
 * retained), ▼ when it raised it (regressed), ≈ when flat. Renders nothing until a
 * merge had a held-out set to score. `delta = baseLoss - newLoss`.
 */
function RegressionChip({ t, evalPoint }: { t: EvermindConsoleLabels; evalPoint: EvermindEvalPoint | null }) {
  if (!evalPoint || !(evalPoint.baseLoss > 0)) return null;
  const frac = evalPoint.delta / evalPoint.baseLoss;
  const pct = Math.abs(frac) * 100;
  const tone: 'up' | 'down' | 'flat' = pct < 0.5 ? 'flat' : frac > 0 ? 'up' : 'down';
  const arrow = tone === 'up' ? '▲' : tone === 'down' ? '▼' : '≈';
  const color = tone === 'up' ? '#22c55e' : tone === 'down' ? '#f87171' : C.text2;
  const label = tone === 'flat' ? t.evalFlat : t.evalDelta(pct.toFixed(1));
  const title = t.evalTooltip(evalPoint.version, evalPoint.baseLoss.toFixed(3), evalPoint.newLoss.toFixed(3), evalPoint.evalSize);
  return (
    <span
      title={title} aria-label={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700,
        color, border: `1px solid ${color}`, borderRadius: 999, padding: '2px 8px',
      }}
    >
      <span aria-hidden>{arrow}</span>{label}
    </span>
  );
}

function Section({ children, ...rest }: React.PropsWithChildren<React.HTMLAttributes<HTMLElement>>) {
  return (
    <section
      {...rest}
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        background: C.surface,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {children}
    </section>
  );
}

function SeedControls({
  t, canManage, busy, models, selectedSlug, onSelect, onSeed,
}: {
  t: EvermindConsoleLabels; canManage: boolean; busy: boolean; models: EvermindSeedModel[];
  selectedSlug: string; onSelect: (s: string) => void; onSeed: () => void;
}) {
  if (!canManage) return <p style={italic}>{t.notSetUp}</p>;
  if (models.length === 0) return <p style={italic}>{t.noModels}</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={fieldLabel}>{t.pickModelLabel}</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={selectedSlug} onChange={(e) => onSelect(e.target.value)} disabled={busy} style={{ ...select, flex: '1 1 200px' }}>
          {models.map((m) => <option key={m.slug} value={m.slug} style={optionStyle}>{m.name}</option>)}
        </select>
        <button type="button" onClick={onSeed} disabled={busy || !selectedSlug} style={primaryBtn(busy || !selectedSlug)}>
          {busy ? t.working : t.enableCta}
        </button>
      </div>
    </div>
  );
}

function StatRow({ t, data }: { t: EvermindConsoleLabels; data: EvermindConsoleData }) {
  const last = data.lastLearnedAt ? t.formatWhen(new Date(data.lastLearnedAt).getTime()) : t.neverLearned;
  const stats: Array<{ label: string; value: string }> = [
    { label: t.versionLabel, value: `v${data.version}` },
    { label: t.contributionsLabel, value: String(data.contributions) },
    { label: t.pendingLabel, value: String(data.pending) },
    { label: t.lastLearnedLabel, value: last },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))', gap: 8 }}>
      {stats.map((s) => (
        <div key={s.label} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: C.text2 }}>{s.label}</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: C.text, marginTop: 2, wordBreak: 'break-word' }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function ToggleRow({
  label, hint, on, disabled, onToggle, onText, offText,
}: {
  label: string; hint: string; on: boolean; disabled: boolean; onToggle: () => void; onText: string; offText: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={fieldTitle}>{label}</div>
        <div style={fieldHint}>{hint}</div>
      </div>
      <button
        type="button" onClick={onToggle} disabled={disabled} aria-pressed={on}
        style={{
          padding: '6px 14px', fontSize: '0.78rem', fontWeight: 700, borderRadius: 999,
          border: `1px solid ${on ? C.accent : C.border}`,
          background: on ? C.accent : C.surface2,
          color: on ? '#fff' : C.text2,
          cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: disabled ? 0.7 : 1,
        }}
      >
        {on ? onText : offText}
      </button>
    </div>
  );
}

function TeacherPicker({
  t, canManage, busy, opts, value, onChange,
}: {
  t: EvermindConsoleLabels; canManage: boolean; busy: boolean;
  opts: EvermindTeacherOptions | null; value: string; onChange: (m: string) => void;
}) {
  // Keep a currently-pinned teacher visible even if it's no longer in the plan pool.
  const models = opts?.models ?? [];
  const options = value && !models.includes(value) ? [value, ...models] : models;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div>
        <div style={fieldTitle}>{t.teacherLabel}</div>
        <div style={fieldHint}>{t.teacherHint}</div>
      </div>
      {!canManage ? (
        <div style={{ ...select, color: C.text2 }}>{value || t.teacherNone}</div>
      ) : opts && !opts.isPaid ? (
        <p style={italic}>{t.teacherPaidOnly}</p>
      ) : (
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={busy} aria-label={t.teacherLabel} style={{ ...select, maxWidth: 340 }}>
          <option value="" style={optionStyle}>{t.teacherNone}</option>
          {options.map((m) => <option key={m} value={m} style={optionStyle}>{m}</option>)}
        </select>
      )}
      {value && (
        <div style={{ fontSize: '0.72rem', lineHeight: 1.4, color: C.accent, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px' }}>
          {t.teacherActiveHint(value)}
        </div>
      )}
    </div>
  );
}

function TeachBox({
  t, busy, validating, prompt, text, onPrompt, onText, onTeach, onValidate, teacherModel,
}: {
  t: EvermindConsoleLabels; busy: boolean; validating: boolean; prompt: string; text: string;
  onPrompt: (s: string) => void; onText: (s: string) => void; onTeach: () => void; onValidate: () => void;
  /** When a teacher is pinned, teach a TASK (the teacher answers it) — no transcript needed. */
  teacherModel: string;
}) {
  const teaching = !!teacherModel;
  const canTeach = teaching ? prompt.trim().length >= 20 : text.trim().length >= 20;
  // Validate needs only a short task string (the prompt when teaching a task, else
  // whatever task/transcript is typed) — a lower bar than teaching.
  const canValidate = (teaching ? prompt : (prompt.trim() || text)).trim().length >= 3;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
      <div style={fieldTitle}>{teaching ? t.teachTeacherTitle : t.teachTitle}</div>
      <div style={fieldHint}>{teaching ? t.teachTeacherHint(teacherModel) : t.teachHint}</div>
      {teaching ? (
        <textarea value={prompt} onChange={(e) => onPrompt(e.target.value)} disabled={busy} placeholder={t.teachTaskPlaceholder} rows={3} style={{ ...select, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
      ) : (
        <>
          <input value={prompt} onChange={(e) => onPrompt(e.target.value)} disabled={busy} placeholder={t.teachPromptPlaceholder} style={{ ...select, width: '100%' }} />
          <textarea value={text} onChange={(e) => onText(e.target.value)} disabled={busy} placeholder={t.teachTextPlaceholder} rows={3} style={{ ...select, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onTeach} disabled={busy || !canTeach} style={primaryBtn(busy || !canTeach)}>
          {busy ? t.teaching : (teaching ? t.teachTeacherCta : t.teachCta)}
        </button>
        <button type="button" onClick={onValidate} disabled={busy || validating || !canValidate} style={secondaryBtn(busy || validating || !canValidate)} title={t.validateHint}>
          {validating ? t.validating : t.validateCta}
        </button>
      </div>
    </div>
  );
}

/** Import-from-builderforce-memory action — folds a local memory snapshot into the
 *  model and compacts the absorbed facts to stubs. Frozen learning disables it (the
 *  same guard the flush uses), since a frozen model can't absorb the import. */
function ImportBox({ t, busy, frozen, onImport }: { t: EvermindConsoleLabels; busy: boolean; frozen: boolean; onImport: () => void }) {
  const disabled = busy || frozen;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
      <div style={fieldTitle}>{t.importTitle}</div>
      <div style={fieldHint}>{t.importHint}</div>
      <button type="button" onClick={onImport} disabled={disabled} style={{ ...secondaryBtn(disabled), alignSelf: 'flex-start' }}>
        {busy ? t.importing : t.importCta}
      </button>
    </div>
  );
}

/** The Validate recall preview: which learned memories would answer the task, ranked. */
function ValidateResults({ t, result, onClear }: { t: EvermindConsoleLabels; result: EvermindValidateResult; onClear: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...fieldTitle, flex: 1, minWidth: 0 }}>{t.validateResultTitle(result.prompt)}</span>
        <span style={{ fontSize: '0.64rem', fontWeight: 600, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 999, padding: '1px 8px' }}>{t.validateMethod(result.method)}</span>
        <button type="button" onClick={onClear} style={{ ...ghostBtn, marginLeft: 0 }}>{t.validateClear}</button>
      </div>
      {result.matches.length === 0 ? (
        <p style={italic}>{t.validateEmpty}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {result.matches.map((m) => {
            const primary = m.id === result.primaryId;
            const pct = Math.round(m.score * 100);
            return (
              <li key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, border: `1px solid ${primary ? C.accent : C.border}`, borderRadius: 6, padding: '6px 8px', background: C.surface }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {primary && <span style={tag(false)}>{t.validatePrimaryBadge}</span>}
                  <span style={{ fontSize: '0.68rem', color: C.text2 }}>{t.versionTag(m.version)}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.68rem', fontWeight: 700, color: C.accent }}>{t.validateScore(pct)}</span>
                </div>
                {/* Score bar so relative recall strength reads at a glance. */}
                <div style={{ height: 4, borderRadius: 999, background: C.border, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: C.accent }} />
                </div>
                {m.prompt && <div style={{ fontSize: '0.74rem', fontWeight: 600, color: C.text, wordBreak: 'break-word' }}>{m.prompt}</div>}
                {m.text && <div style={{ fontSize: '0.72rem', color: C.text2, lineHeight: 1.4, wordBreak: 'break-word', whiteSpace: 'pre-wrap', maxHeight: 54, overflow: 'hidden' }}>{m.text}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RecentList({ t, entries }: { t: EvermindConsoleLabels; entries: EvermindRecentEntry[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
      <div style={fieldTitle}>{t.inspectTitle}</div>
      {entries.length === 0 ? (
        <p style={italic}>{t.inspectEmpty}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.map((e) => <RecentRow key={e.id} t={t} entry={e} />)}
        </ul>
      )}
    </div>
  );
}

function RecentRow({ t, entry }: { t: EvermindConsoleLabels; entry: EvermindRecentEntry }) {
  const [open, setOpen] = useState(false);
  const status = evermindLearnedStatus(entry);
  // A pinned teacher that answered nothing leaves only the raw input behind — which on a
  // teach-a-task IS the question. Showing it would present the question as its own
  // answer, so the row reports the fault instead. [[evermind-learning-architecture]]
  const faulted = status.state === 'fault';
  const body = entry.kind === 'delta' ? t.deltaEntry : (faulted ? '' : (entry.text ?? ''));
  // A delta carries no inspectable text; only text contributions have detail to expand.
  const hasDetail = entry.kind !== 'delta' && (!!entry.prompt || !!entry.text || faulted);
  return (
    <li style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={tag(entry.kind === 'delta')}>{entry.kind === 'delta' ? t.kindDelta : t.kindText}</span>
        <span style={{ fontSize: '0.68rem', color: C.text2 }}>{t.versionTag(entry.version)}</span>
        <span style={{ fontSize: '0.68rem', color: C.text2 }}>{t.weightTag(entry.weight)}</span>
        {faulted && <span style={faultTag}>{t.notDistilled}</span>}
        {status.state === 'distilled' && status.teacherModel && (
          <span style={{ fontSize: '0.68rem', color: C.text2 }}>{t.distilledBy(status.teacherModel)}</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: C.text2 }}>{t.formatWhen(entry.at)}</span>
      </div>
      {entry.prompt && <div style={{ fontSize: '0.76rem', fontWeight: 600, color: C.text, wordBreak: 'break-word' }}>{entry.prompt}</div>}
      {open ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
          {faulted ? (
            <div style={{ fontSize: '0.74rem', color: C.text2, lineHeight: 1.5 }}>
              {t.teacherFault(status.teacherModel ?? '', status.reason)}
            </div>
          ) : entry.text && (
            <div>
              <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: C.text2 }}>{t.detailTextLabel}</div>
              <div style={{ fontSize: '0.74rem', color: C.text, lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{entry.text}</div>
            </div>
          )}
        </div>
      ) : (
        body && <div style={{ fontSize: '0.74rem', color: C.text2, lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'pre-wrap', maxHeight: 72, overflow: 'hidden' }}>{body}</div>
      )}
      {hasDetail && (
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...linkBtn, alignSelf: 'flex-start' }}>
          {open ? t.hideDetail : t.viewDetail}
        </button>
      )}
    </li>
  );
}

/** The "not distilled" warning tag. `--bf-warn-*` cascade from the host theme, with
 *  literal fallbacks that stay legible on both light and dark surfaces. */
const faultTag: React.CSSProperties = {
  fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
  padding: '1px 6px', borderRadius: 5,
  color: 'var(--bf-warn-text, #92400e)',
  background: 'var(--bf-warn-bg, #fef3c7)',
  border: '1px solid var(--bf-warn-border, #f59e0b)',
};

/* ── Style atoms ──────────────────────────────────────────────────────────── */

const italic: React.CSSProperties = { margin: 0, fontSize: '0.78rem', color: C.text2, fontStyle: 'italic' };
const fieldLabel: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 600, color: C.text2 };
const fieldTitle: React.CSSProperties = { fontSize: '0.82rem', fontWeight: 600, color: C.text };
const fieldHint: React.CSSProperties = { fontSize: '0.72rem', color: C.text2, lineHeight: 1.4 };
const select: React.CSSProperties = {
  padding: '7px 9px', fontSize: '0.8rem', borderRadius: 8,
  border: `1px solid ${C.border}`, background: C.surface2, color: C.text, boxSizing: 'border-box',
};
/* Native <option> popup is drawn by the OS and IGNORES the translucent surface tokens the
   <select> uses — options must carry their OWN opaque bg/fg or theme text lands on a white
   OS popup (light-on-white, unreadable). Cascade ends in the Canvas/CanvasText system-color
   pair, which is always a legible opaque duo and follows OS light/dark. */
const optionStyle: React.CSSProperties = {
  background: 'var(--bf-ev-surface-solid, var(--bg-surface, var(--vscode-dropdown-background, Canvas)))',
  color: 'var(--bf-ev-text, var(--text-primary, var(--vscode-dropdown-foreground, CanvasText)))',
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px', fontSize: '0.8rem', fontWeight: 600, borderRadius: 8,
    border: '1px solid transparent',
    background: disabled ? C.surface2 : C.accent,
    color: disabled ? C.text2 : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
  };
}

const ghostBtn: React.CSSProperties = {
  marginLeft: 'auto', padding: '2px 8px', fontSize: '0.9rem', lineHeight: 1,
  borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent',
  color: C.text2, cursor: 'pointer',
};

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px', fontSize: '0.8rem', fontWeight: 600, borderRadius: 8,
    border: `1px solid ${C.border}`, background: 'transparent',
    color: disabled ? C.text2 : C.text,
    cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: disabled ? 0.7 : 1,
  };
}

const linkBtn: React.CSSProperties = {
  padding: 0, fontSize: '0.7rem', fontWeight: 600, border: 'none', background: 'transparent',
  color: C.accent, cursor: 'pointer',
};

function pill(seeded: boolean): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999,
    border: `1px solid ${C.border}`, background: C.surface2,
    color: seeded ? C.accent : C.text2,
  };
}

function tag(isDelta: boolean): React.CSSProperties {
  return {
    fontSize: '0.64rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
    padding: '1px 6px', borderRadius: 5, border: `1px solid ${C.border}`,
    color: isDelta ? C.text2 : C.accent, background: C.surface,
  };
}
