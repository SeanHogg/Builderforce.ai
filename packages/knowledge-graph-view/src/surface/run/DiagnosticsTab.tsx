/**
 * The Reviews panel's Diagnostics tab: the SAME diagnostics "Copy diagnostics" copies, shown as collapsible groups (graph, review and last run, data coverage, lines,
 * sync and replica, findings). The groups come from the one source the text is built from (`graphDiagnostics.ts`), so what is shown is what is copied. A group with
 * something to look at (a failure) comes first and is open; the others are collapsed. "Taken HH:MM:SS" says when this snapshot was made; Refresh makes a new one.
 */

import { useMemo, useState } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { splitLine, type DiagnosticSection, type DiagnosticSectionId, type Diagnostics } from '../../diagnosticSection';
import { cssVar } from '../../scene/themeColors';
import { button } from '../../styles';
import { TYPE } from '../ui/type';
import { CopyDiagnostics } from './CopyDiagnostics';

export interface DiagnosticsTabProps {
    labels: KnowledgeGraphLabels;
    /** Takes the diagnostics now; absent ⇒ nothing to show. */
    diagnostics: (() => Diagnostics) | undefined;
}

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** The groups with something to look at first (in their own order), then the rest. */
export const attentionFirst = (sections: readonly DiagnosticSection[]): DiagnosticSection[] =>
    [...sections.filter((s) => s.attention), ...sections.filter((s) => !s.attention)];

export function DiagnosticsTab({ labels, diagnostics }: DiagnosticsTabProps) {
    const r = labels.surface.run.review;
    const [stamp, setStamp] = useState(0);
    const titles: Record<DiagnosticSectionId, string> = { graph: r.diagGraph, review: r.diagReview, coverage: r.diagCoverage, lines: r.diagLines, sync: r.diagSync, findings: r.diagFindings };
    // A snapshot of the moment the tab opened or Refresh was pressed; a failure to build it leaves the tab empty rather than breaking the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const taken = useMemo((): Diagnostics | null => { try { return diagnostics?.() ?? null; } catch { return null; } }, [diagnostics, stamp]);
    const sections = taken ? attentionFirst(taken.sections) : [];
    return (
        <div data-testid="kg-diagnostics-tab" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <button type="button" style={button} onClick={() => setStamp((n) => n + 1)}>{r.diagRefresh}</button>
                <CopyDiagnostics labels={labels} text={diagnostics ? () => diagnostics().text : undefined} />
                {taken && <span data-testid="kg-diag-taken" style={{ ...TYPE.meta, alignSelf: 'center' }}>{fillTemplate(r.diagTaken, { time: CLOCK.format(new Date(taken.takenAt)) })}</span>}
            </div>
            {sections.length === 0 ? <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{r.diagEmpty}</p> : sections.map((s) => (
                <details key={`${stamp}-${s.id}`} data-testid={`kg-diag-${s.id}`} data-attention={s.attention ? 'true' : undefined} open={s.attention}>
                    <summary style={{ ...TYPE.sectionHeading, cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center', gap: 8, color: s.attention ? cssVar('violation') : undefined }}>
                        {titles[s.id]}
                    </summary>
                    <dl style={{ margin: 0, display: 'grid', gap: 2, ...TYPE.monoName, userSelect: 'text' }}>
                        {s.lines.map((line, i) => {
                            const l = splitLine(line);
                            return (
                                <div key={`${i}-${line}`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {l.key !== undefined && <dt style={{ margin: 0, flex: 'none', ...TYPE.meta }}>{l.key}</dt>}
                                    <dd style={{ margin: 0, minWidth: 0, flex: '1 1 160px', overflowWrap: 'anywhere' }}>{l.value}</dd>
                                </div>
                            );
                        })}
                    </dl>
                </details>
            ))}
        </div>
    );
}
