/**
 * <EvermindAnalyzer> — read back everything the model has learned, have it checked, and
 * fix what is wrong.
 *
 * The learning loop is write-only from the operator's side: runs, teaches and imports
 * pour knowledge in, and nothing ever asks whether any of it is correct. A wrong
 * exemplar is learned exactly as confidently as a right one and then recalled forever.
 *
 * This closes the loop. The audit is READ-ONLY: it lists each questionable memory, what
 * is wrong with it, and — where there is a right answer — the correction that would
 * replace it. Nothing changes until the operator picks findings and applies them, which
 * forgets the bad memory and teaches the correction in its place.
 *
 * Selection defaults to everything actionable (the common case is "fix it all"), but
 * every row is individually checkable, because a correction is a judgement call and the
 * operator is the one accountable for the model's knowledge.
 */
import { useCallback, useMemo, useState } from 'react';
import type {
  EvermindConsoleLabels,
  EvermindKnowledgeAnalysis,
  EvermindKnowledgeFinding,
  EvermindKnowledgeRepair,
  EvermindKnowledgeVerdict,
} from './types';
import {
  C, fieldTitle, fieldHint, sectionBlock, italic, outputBox,
  primaryBtn, secondaryBtn, linkBtn, verdictTag, warnBox,
} from './consoleStyles';

export interface EvermindAnalyzerProps {
  t: EvermindConsoleLabels;
  disabled: boolean;
  onAnalyze: () => Promise<EvermindKnowledgeAnalysis>;
  /** Absent → the audit is report-only (no host repair path). */
  onApply?: (findings: EvermindKnowledgeFinding[]) => Promise<EvermindKnowledgeRepair>;
  /** Called after a successful repair so the host can refresh its stats. */
  onRepaired?: () => void;
}

/** How severely each verdict reads. `redundant` is tidy-up, not a defect. */
const TONE: Record<EvermindKnowledgeVerdict, 'ok' | 'warn' | 'bad'> = {
  ok: 'ok',
  incoherent: 'bad',
  incorrect: 'bad',
  outdated: 'warn',
  unusable: 'bad',
  redundant: 'warn',
};

export function EvermindAnalyzer({ t, disabled, onAnalyze, onApply, onRepaired }: EvermindAnalyzerProps) {
  const [analysis, setAnalysis] = useState<EvermindKnowledgeAnalysis | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [repair, setRepair] = useState<EvermindKnowledgeRepair | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true); setError(null); setRepair(null);
    try {
      const result = await onAnalyze();
      setAnalysis(result);
      // Default to "fix everything that's wrong" — the common intent.
      setSelected(new Set(result.findings.map((f) => f.id)));
    } catch (err) {
      setAnalysis(null);
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setRunning(false);
    }
  }, [onAnalyze, t.errorGeneric]);

  const apply = useCallback(async () => {
    if (!onApply || !analysis) return;
    const picked = analysis.findings.filter((f) => selected.has(f.id));
    if (picked.length === 0) return;
    setApplying(true); setError(null);
    try {
      setRepair(await onApply(picked));
      // The repaired memories are gone from the ring, so the stale audit must not
      // linger offering to fix them again.
      setAnalysis(null);
      setSelected(new Set());
      onRepaired?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setApplying(false);
    }
  }, [analysis, onApply, onRepaired, selected, t.errorGeneric]);

  const toggle = useCallback((id: number) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const findings = analysis?.findings ?? [];
  const allSelected = useMemo(() => findings.length > 0 && findings.every((f) => selected.has(f.id)), [findings, selected]);
  const busy = disabled || running || applying;

  return (
    <div style={sectionBlock}>
      <div style={fieldTitle}>{t.analyzeTitle}</div>
      <div style={fieldHint}>{t.analyzeHint}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void run()} disabled={busy} style={secondaryBtn(busy)}>
          {running ? t.analyzing : t.analyzeCta}
        </button>
        {findings.length > 0 && onApply && (
          <>
            <button type="button" onClick={() => void apply()} disabled={busy || selected.size === 0} style={primaryBtn(busy || selected.size === 0)}>
              {applying ? t.analyzeApplying : t.analyzeApplyCta(selected.size)}
            </button>
            <button
              type="button"
              onClick={() => setSelected(allSelected ? new Set() : new Set(findings.map((f) => f.id)))}
              disabled={busy}
              style={linkBtn}
            >
              {allSelected ? t.analyzeSelectNone : t.analyzeSelectAll}
            </button>
          </>
        )}
      </div>

      {error && <p style={{ margin: 0, fontSize: '0.76rem', color: C.danger }} role="alert">{error}</p>}

      {repair && (
        <p style={{ margin: 0, fontSize: '0.76rem', color: C.accent }} role="status">
          {t.analyzeApplied(repair.corrected, repair.forgotten, repair.version)}
          {repair.skipped.length > 0 ? ` ${t.analyzeSkipped(repair.skipped.length)}` : ''}
        </p>
      )}

      {/* A partial audit (the frontier reviewer was unreachable) still reports what the
          local coherence screen found — but says so, rather than implying a clean bill. */}
      {analysis?.warning && <p style={warnBox} role="note">{analysis.warning}</p>}

      {analysis && findings.length === 0 && <p style={italic}>{t.analyzeClean(analysis.analyzed)}</p>}

      {analysis && findings.length > 0 && (
        <>
          <p style={{ margin: 0, fontSize: '0.74rem', color: C.text2 }}>
            {analysis.model
              ? t.analyzeSummary(findings.length, analysis.analyzed, analysis.model)
              : t.analyzeSummaryLocal(findings.length, analysis.analyzed)}
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {findings.map((f) => (
              <FindingRow
                key={f.id} t={t} finding={f}
                selectable={!!onApply} selected={selected.has(f.id)} disabled={busy}
                onToggle={() => toggle(f.id)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function FindingRow({
  t, finding, selected, selectable, disabled, onToggle,
}: {
  t: EvermindConsoleLabels;
  finding: EvermindKnowledgeFinding;
  selected: boolean;
  selectable: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const tone = TONE[finding.verdict] ?? 'warn';
  return (
    <li style={{
      background: C.surface2, border: `1px solid ${selected ? C.accent : C.border}`, borderRadius: 8,
      padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {selectable && (
          <input
            type="checkbox" checked={selected} onChange={onToggle} disabled={disabled}
            aria-label={finding.issue} style={{ margin: 0, cursor: disabled ? 'not-allowed' : 'pointer' }}
          />
        )}
        <span style={verdictTag(tone)}>{t.analyzeVerdict(finding.verdict)}</span>
        {finding.prompt && (
          <span style={{ fontSize: '0.74rem', fontWeight: 600, color: C.text, wordBreak: 'break-word', minWidth: 0 }}>
            {finding.prompt}
          </span>
        )}
      </div>
      <div style={{ fontSize: '0.74rem', lineHeight: 1.45, color: C.text }}>{finding.issue}</div>
      <div style={{ ...outputBox, maxHeight: 96, fontSize: '0.7rem', color: C.text2 }}>{finding.excerpt}</div>
      {finding.correction && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: C.text2 }}>
            {t.analyzeCorrectionLabel}
          </div>
          <div style={{ ...outputBox, maxHeight: 140, fontSize: '0.7rem' }}>{finding.correction}</div>
        </div>
      )}
    </li>
  );
}
