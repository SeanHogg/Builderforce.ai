/**
 * The run delta trend (PRD 41 §C11.3, D7): how a project's runs have moved over time.
 *
 *  - **Verdict by dimension** — one row per dimension, one column per run (oldest left), each cell
 *    the verdict's icon in its theme colour: the shape carries the verdict, so colour is never the
 *    only signal, and each cell names itself in a tooltip.
 *  - **Blast radius score** — the per-run score as a line, each point coloured by its band.
 *
 * Inline SVG, theme tokens only, so it reads in both themes on the web and in the VS Code webview.
 * Each chart is a `role="img"` with a text summary; the matrix scrolls inside its own box rather
 * than widening the page at 360 px. Props only.
 */

import type { RunDeltaSummary } from '@builderforce/run-delta';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';
import { fillTemplate } from '../../template';
import { dimensionLabel, verdictLabel } from '../deltaText';
import type { RunDeltaLabels } from '../labels';
import { VERDICT_TONE, VerdictIcon } from '../VerdictMark';
import { BAND_TONE } from './BandMark';
import type { RunDeltaHistoryLabels } from './historyLabels';
import { trendModel, TREND_MAX_RUNS } from './historyModel';
import { defaultFormatNumber, defaultFormatTime, type DeltaFormatProps } from './formatters';

const CELL = 18;
const LINE_W = 320;
const LINE_H = 96;
const PAD = 8;

export interface DeltaTrendProps extends DeltaFormatProps {
    items: readonly RunDeltaSummary[];
    labels: RunDeltaLabels;
    historyLabels: RunDeltaHistoryLabels;
    maxRuns?: number | undefined;
}

const chartHeading = { ...TYPE.subtitle, color: cssVar('text') } as const;

export function DeltaTrend({ items, labels, historyLabels, formatTime = defaultFormatTime, formatNumber = defaultFormatNumber, maxRuns = TREND_MAX_RUNS }: DeltaTrendProps) {
    const model = trendModel(items, maxRuns);
    if (model.runs.length < 2) return <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{historyLabels.tooFewRuns}</p>;

    const { runs, dimensions, cells, blast } = model;
    const times = runs.map((r) => formatTime(r.computedAt));
    const matrixSummary = fillTemplate(historyLabels.trendSummary, { runs: formatNumber(runs.length), worse: formatNumber(model.counts.worse), better: formatNumber(model.counts.better) });
    const latest = blast.latest!;
    const blastSummary = fillTemplate(historyLabels.blastSummary, {
        score: formatNumber(latest.blastRadius.score), band: labels.bands[latest.blastRadius.band], min: formatNumber(blast.min), max: formatNumber(blast.max),
    });

    const span = blast.max - blast.min;
    const x = (i: number) => PAD + (runs.length === 1 ? 0 : (i * (LINE_W - 2 * PAD)) / (runs.length - 1));
    const y = (score: number) => (span === 0 ? LINE_H / 2 : PAD + (1 - (score - blast.min) / span) * (LINE_H - 2 * PAD));
    const path = runs.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(r.blastRadius.score).toFixed(1)}`).join(' ');

    return (
        <div data-run-delta-trend style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            <figure style={{ margin: 0, display: 'grid', gap: 6, minWidth: 0 }}>
                <figcaption style={chartHeading}>{historyLabels.verdictTrend}</figcaption>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(84px, max-content) minmax(0, 1fr)', columnGap: 8, alignItems: 'start', minWidth: 0 }}>
                    <ul aria-hidden="true" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {dimensions.map((d) => (
                            <li key={d} style={{ ...TYPE.meta, height: CELL, lineHeight: `${CELL}px`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
                                {dimensionLabel(labels, d)}
                            </li>
                        ))}
                    </ul>
                    <div style={{ overflowX: 'auto', minWidth: 0 }}>
                        <svg
                            role="img"
                            aria-label={matrixSummary}
                            width={runs.length * CELL}
                            height={dimensions.length * CELL}
                            viewBox={`0 0 ${runs.length * CELL} ${dimensions.length * CELL}`}
                            style={{ display: 'block' }}
                        >
                            {cells.map((row, d) => row.map((verdict, r) => {
                                if (!verdict) return null;
                                const title = fillTemplate(historyLabels.cellTitle, {
                                    dimension: dimensionLabel(labels, dimensions[d]!), verdict: verdictLabel(labels, verdict), time: times[r],
                                });
                                return (
                                    <g key={`${d}:${r}`} data-cell={`${dimensions[d]}:${r}`} data-verdict={verdict} transform={`translate(${r * CELL + 2} ${d * CELL + 2})`} style={{ color: VERDICT_TONE[verdict] }}>
                                        <title>{title}</title>
                                        <rect width={CELL - 4} height={CELL - 4} rx={3} fill="transparent" />
                                        <VerdictIcon verdict={verdict} size={CELL - 4} />
                                    </g>
                                );
                            }))}
                        </svg>
                    </div>
                </div>
                <p style={{ ...TYPE.meta, margin: 0 }}>{matrixSummary}</p>
            </figure>

            <figure style={{ margin: 0, display: 'grid', gap: 6, minWidth: 0 }}>
                <figcaption style={chartHeading}>{historyLabels.blastTrend}</figcaption>
                <svg role="img" aria-label={blastSummary} viewBox={`0 0 ${LINE_W} ${LINE_H}`} width="100%" style={{ display: 'block', maxWidth: LINE_W * 2, height: 'auto' }}>
                    <line x1={PAD} x2={LINE_W - PAD} y1={LINE_H - PAD} y2={LINE_H - PAD} stroke={cssVar('border')} strokeWidth={1} />
                    <path d={path} fill="none" stroke={cssVar('muted')} strokeWidth={1.5} strokeLinejoin="round" />
                    {runs.map((r, i) => (
                        <circle key={`${r.runId}:${r.repoKey}`} data-point={r.blastRadius.band} cx={x(i)} cy={y(r.blastRadius.score)} r={3.5} fill={BAND_TONE[r.blastRadius.band]} stroke={cssVar('bg')} strokeWidth={1}>
                            <title>{fillTemplate(historyLabels.pointTitle, { score: formatNumber(r.blastRadius.score), band: labels.bands[r.blastRadius.band], time: times[i] })}</title>
                        </circle>
                    ))}
                </svg>
                <p style={{ ...TYPE.meta, margin: 0, overflowWrap: 'anywhere' }}>{blastSummary}</p>
            </figure>
        </div>
    );
}
