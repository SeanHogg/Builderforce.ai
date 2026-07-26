/**
 * <EvermindTestBench> — run a prompt through the project's model and see exactly what
 * it writes, graded by the same rule that decides whether a real reply is shown.
 *
 * This is the surface the console was missing. "Validate" answers *which learned
 * memories would be recalled*; it generates nothing, so a head that emits fluent
 * gibberish looks perfectly healthy right up until a user receives some. The only way
 * to know what a model will say is to make it say something — and then judge it with
 * the production rule, not by eye.
 *
 * Two modes, one grader:
 *   - a READINESS CHECK runs the fixed probe suite that gates switching replies on, so
 *     "will this be allowed to serve?" is answerable before you try;
 *   - a PROMPT run is the operator's own question.
 *
 * Output is shown verbatim (no cleanup, no truncation) — the whole point is to see the
 * real thing, including the ugly parts.
 */
import { useCallback, useState } from 'react';
import type { EvermindConsoleLabels, EvermindProbeResult } from './types';
import {
  C, fieldTitle, fieldHint, sectionBlock, select, outputBox,
  primaryBtn, secondaryBtn, verdictTag, italic,
} from './consoleStyles';

export interface EvermindTestBenchProps {
  t: EvermindConsoleLabels;
  /** Disabled (not hidden) for non-managers and while another action is in flight. */
  disabled: boolean;
  /** Runs a probe; `undefined` prompt = the fixed readiness suite. */
  onProbe: (prompt?: string) => Promise<EvermindProbeResult>;
  /**
   * The last run, OWNED BY THE CONSOLE. Lifted out of this component because the result
   * outlives the tab: the diagnostics export has to include output produced on a tab the
   * operator has since left, and a failed readiness check has to keep flagging itself
   * from the other tabs. Local state would be destroyed on every tab switch.
   */
  result: EvermindProbeResult | null;
  onResult: (result: EvermindProbeResult | null) => void;
}

export function EvermindTestBench({ t, disabled, onProbe, result, onResult }: EvermindTestBenchProps) {
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (withPrompt: boolean) => {
    setRunning(true); setError(null);
    try {
      onResult(await onProbe(withPrompt ? prompt.trim() : undefined));
    } catch (err) {
      onResult(null);
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setRunning(false);
    }
  }, [onProbe, onResult, prompt, t.errorGeneric]);

  const busy = disabled || running;
  const canRunPrompt = prompt.trim().length >= 3;
  const passed = result?.samples.filter((s) => s.coherent).length ?? 0;

  return (
    <div style={sectionBlock}>
      <div style={fieldTitle}>{t.testTitle}</div>
      <div style={fieldHint}>{t.testHint}</div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={busy}
        placeholder={t.testPlaceholder}
        rows={2}
        style={{ ...select, width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void run(true)} disabled={busy || !canRunPrompt} style={primaryBtn(busy || !canRunPrompt)}>
          {running ? t.testRunning : t.testRunCta}
        </button>
        <button type="button" onClick={() => void run(false)} disabled={busy} style={secondaryBtn(busy)}>
          {t.testReadinessCta}
        </button>
      </div>

      {error && <p style={{ margin: 0, fontSize: '0.76rem', color: C.danger }} role="alert">{error}</p>}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ ...fieldTitle, flex: '1 1 auto', minWidth: 0 }}>
              {result.mode === 'readiness' ? t.testResultReadiness(passed, result.samples.length) : t.testResultPrompt}
            </span>
            <span style={verdictTag(result.ready ? 'ok' : 'bad')}>
              {result.ready ? t.testServable : t.testRefused}
            </span>
          </div>
          {/* The verdict in words — a pass/fail chip alone doesn't tell an operator
              what to DO about it. */}
          <p style={{ margin: 0, fontSize: '0.74rem', lineHeight: 1.5, color: result.ready ? C.text2 : C.danger }}>
            {result.ready ? t.testVerdictReady : t.testVerdictNotReady}
          </p>
          {result.samples.map((s, i) => (
            <div key={`${s.prompt}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {result.samples.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={verdictTag(s.coherent ? 'ok' : 'bad')}>{s.coherent ? t.testServable : t.testRefused}</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: C.text, wordBreak: 'break-word', minWidth: 0 }}>{s.prompt}</span>
                </div>
              )}
              <div style={outputBox}>{s.text.trim() || t.testEmptyOutput}</div>
              {!s.coherent && s.detail && (
                <p style={{ ...italic, color: C.danger, fontStyle: 'normal', fontSize: '0.72rem' }}>
                  {t.testRefusedBecause(s.detail)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
