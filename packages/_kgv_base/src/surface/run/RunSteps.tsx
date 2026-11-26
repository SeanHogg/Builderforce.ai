/**
 * The Run panel's step feed (PRD 41 A8): the last steps of the run, newest first (the host keeps a
 * ring of 200), filtered to all, failed, skipped or reused. Each row: the outcome glyph (with its
 * word for assistive tech), the file, the phase and how long it took.
 */

import { useState } from 'react';
import type { ReviewStepOutcome } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import type { StoredReviewRun } from '../../types';
import { Section } from '../drawers/ui';
import { counted } from '../plural';
import { stationName } from '../stationName';
import { Segmented } from '../ui';
import { TYPE } from '../ui/type';
import { STEP_FILTERS, visibleSteps, type StepFilter } from './runModel';

const GLYPH: Record<ReviewStepOutcome, { mark: string; tone: ThemeTone }> = {
    ok: { mark: '✓', tone: 'agrees' },
    cached: { mark: '↺', tone: 'muted' },
    skipped: { mark: '–', tone: 'muted' },
    failed: { mark: '✕', tone: 'violation' },
};

export function RunSteps({ run, labels }: { run: StoredReviewRun; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.run;
    const [filter, setFilter] = useState<StepFilter>('all');
    const steps = visibleSteps(run.steps, filter);
    return (
        <Section title={run.steps.length > 0 ? counted(labels, 'runStep', run.steps.length) : t.stepsTitle}>
            <Segmented
                label={t.filterLabel} value={filter} onChange={(id) => setFilter(id as StepFilter)}
                items={STEP_FILTERS.map((id) => ({ id, label: t.filters[id] }))}
            />
            {steps.length === 0 ? (
                <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{run.steps.length === 0 ? t.stepsNone : t.stepsNoneFiltered}</p>
            ) : (
                <ul data-testid="kg-run-steps" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
                    {steps.map((s, i) => (
                        <li key={`${run.steps.length - i}-${s.path}-${s.phase}`} data-outcome={s.outcome} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', minHeight: 24 }}>
                            <span role="img" aria-label={t.stepOutcomes[s.outcome]} style={{ ...TYPE.status, color: cssVar(GLYPH[s.outcome].tone), width: 14, textAlign: 'center', flex: 'none' }}>
                                {GLYPH[s.outcome].mark}
                            </span>
                            <span title={s.path} style={{ ...TYPE.monoName, flex: '1 1 120px', minWidth: 0, overflowWrap: 'anywhere' }}>{stationName(s.path)}</span>
                            <span style={TYPE.meta}>{labels.phases[s.phase]}</span>
                            <span style={TYPE.monoMeta}>{fillTemplate(t.units.ms, { count: Math.round(s.ms) })}</span>
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}
