/**
 * The diagnostics export — the console's door out.
 *
 * The console could show an operator that their model was producing gibberish, and
 * could tell them why it was refused, but there was no way to HAND ANY OF THAT TO
 * ANYONE. A screenshot loses the verbatim output, which is the entire evidence: the
 * exact bytes, the broken-token markers, the signal that rejected them. So the fault
 * reached whoever could fix it as a description ("it makes gibberish") rather than as
 * the thing itself.
 *
 * One action produces the whole picture — state, everminds under the project, the last
 * test-bench run with raw output, the last knowledge audit, the tail of the learn log —
 * as markdown on the clipboard. It is offered TWICE, from the console header and from
 * the Maintain tab, because the moment you want it is the moment something is wrong and
 * hunting through tabs is the last thing you want to be doing. Both are the same action:
 * {@link useDiagnosticsCopy} owns the state once and both surfaces render it, so they can
 * never disagree about whether the copy succeeded.
 *
 * Copying is attempted in the order of what actually works per host: the host's own
 * clipboard first (VS Code exposes `env.clipboard`, which works even when the webview has
 * no Clipboard API permission), then `navigator.clipboard`, and if both fail the report
 * is REVEALED AND PRE-SELECTED for manual copying. A copy button that can silently fail
 * is worse than no button, because the operator walks away believing they have the report.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EvermindConsoleLabels } from './types';
import { C, fieldTitle, fieldHint, sectionBlock, secondaryBtn, linkBtn, outputBox } from './consoleStyles';

export interface DiagnosticsCopy {
  /** The last built report, or null before the first attempt. */
  report: string | null;
  /** Whether the last attempt reached the clipboard. Tracked SEPARATELY from whether the
   *  report is on screen, so "show me it anyway" after a successful copy doesn't claim
   *  the copy was blocked. */
  copied: boolean;
  /** Whether the full report is displayed for manual selection. */
  revealed: boolean;
  copy: () => Promise<void>;
  toggleReveal: () => void;
}

export interface UseDiagnosticsCopyOptions {
  /** Builds the report on demand — deferred so nothing is serialised until asked. */
  buildReport: () => string;
  /** OPTIONAL host clipboard (VS Code). Tried before `navigator.clipboard`. */
  onCopy?: ((text: string) => Promise<void>) | undefined;
  /** Called when the copy fell back to manual, so a host can reveal the panel holding
   *  the textarea — a report you cannot see is not a fallback. */
  onManualFallback?: (() => void) | undefined;
}

export function useDiagnosticsCopy({ buildReport, onCopy, onManualFallback }: UseDiagnosticsCopyOptions): DiagnosticsCopy {
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const copy = useCallback(async () => {
    const text = buildReport();
    setReport(text);
    try {
      if (onCopy) await onCopy(text);
      else if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error('no clipboard');
      setCopied(true);
      setRevealed(false);
    } catch {
      // Fall back to "here it is, select it yourself" rather than reporting a success
      // the operator does not have.
      setCopied(false);
      setRevealed(true);
      onManualFallback?.();
    }
  }, [buildReport, onCopy, onManualFallback]);

  const toggleReveal = useCallback(() => setRevealed((v) => !v), []);

  return { report, copied, revealed, copy, toggleReveal };
}

export interface EvermindDiagnosticsProps {
  t: EvermindConsoleLabels;
  disabled: boolean;
  copy: DiagnosticsCopy;
}

export function EvermindDiagnostics({ t, disabled, copy }: EvermindDiagnosticsProps) {
  const { report, copied, revealed } = copy;
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // Select the revealed report as soon as it mounts, so Ctrl/Cmd+C works immediately —
  // the fallback exists for people whose clipboard call was refused, and asking them to
  // also drag-select 200 lines would waste the fallback.
  useEffect(() => {
    if (!revealed) return;
    areaRef.current?.focus();
    areaRef.current?.select();
  }, [revealed]);

  return (
    <div style={sectionBlock}>
      <div style={fieldTitle}>{t.diagnosticsTitle}</div>
      <div style={fieldHint}>{t.diagnosticsHint}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void copy.copy()} disabled={disabled} style={secondaryBtn(disabled)}>
          {t.diagnosticsCta}
        </button>
        {/* No success confirmation HERE — the console header owns the single one, so it
            is seen whichever surface the copy was pressed from. */}
        {report !== null && (
          <button type="button" onClick={copy.toggleReveal} style={linkBtn}>
            {revealed ? t.diagnosticsHide : t.diagnosticsShow}
          </button>
        )}
      </div>

      {revealed && report !== null && (
        <>
          {/* Only when the copy actually FAILED — after a successful copy this same view
              is just "let me read it", and telling that user their clipboard was blocked
              would be a lie about the state of their machine. */}
          {!copied && <p style={{ margin: 0, fontSize: '0.72rem', color: C.text2, lineHeight: 1.4 }}>{t.diagnosticsManualHint}</p>}
          <textarea
            ref={areaRef}
            readOnly
            value={report}
            rows={12}
            aria-label={t.diagnosticsTitle}
            onFocus={(e) => e.currentTarget.select()}
            style={{ ...outputBox, width: '100%', maxHeight: 320, resize: 'vertical', boxSizing: 'border-box' }}
          />
        </>
      )}
    </div>
  );
}
