/**
 * The Coverage drawer's lower half: the test shape (unit / integration / e2e from path
 * conventions), where coverage is configured and the one action that closes the gap. The
 * action asks the composer; the view writes no file itself.
 */

import { useMemo } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { counted } from '../plural';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { muted, primaryButton } from '../../styles';
import { TYPE } from '../ui/type';
import { coverageConfigModel } from './coverageConfigModel';
import { TEST_SHAPES, testShapeModel, type TestShape } from './testShapeModel';
import { Section, Unavailable } from './ui';

const SHAPE_TONE: Record<TestShape, ThemeTone> = { unit: 'agrees', integration: 'accent', e2e: 'cycle' };
const MAX_NAMED = 4;

export function CoverageShape({ graph, labels, onCompose }: {
    graph: KnowledgeGraph;
    labels: KnowledgeGraphLabels;
    onCompose?: ((text: string) => void) | undefined;
}) {
    const t = labels.surface.coverage;
    const shape = useMemo(() => testShapeModel(graph), [graph]);
    const config = useMemo(() => coverageConfigModel(graph), [graph]);
    const names = (xs: readonly string[]) => (xs.length > MAX_NAMED ? fillTemplate(t.namesMore, { names: xs.slice(0, MAX_NAMED).join(', '), count: xs.length - MAX_NAMED }) : xs.join(', '));
    return (
        <>
            <Section title={t.shapeTitle}>
                {shape.total === 0 ? <p data-testid="kg-test-shape-none" style={{ ...muted, margin: 0 }}>{t.shapeNone}</p> : (
                    <div
                        role="img" data-testid="kg-test-shape" style={{ display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden', ...TYPE.tag }}
                        aria-label={fillTemplate(t.shapeAria, { unit: shape.unit, integration: shape.integration, e2e: shape.e2e })}
                    >
                        {TEST_SHAPES.filter((k) => shape[k] > 0).map((k) => (
                            <span key={k} data-shape={k} style={{ flex: shape[k], minWidth: 'fit-content', padding: '0 6px', display: 'flex', alignItems: 'center', background: cssVar(SHAPE_TONE[k]), color: cssVar('onAccent') }}>
                                {fillTemplate(t.shapeSegment, { kind: t[k], count: shape[k] })}
                            </span>
                        ))}
                    </div>
                )}
            </Section>
            <Section title={t.configTitle}>
                {config.packages === 0 ? <p style={{ ...muted, margin: 0 }}>{t.configNone}</p>
                    : config.uncovered.length === 0 ? <p data-testid="kg-coverage-config" style={{ ...muted, margin: 0 }}>{t.configAll}</p>
                        : (
                            <p data-testid="kg-coverage-config" style={{ ...muted, margin: 0, lineHeight: '17px' }}>
                                {config.configured.length === 0 ? t.configNowhere : fillTemplate(t.configOnly, { packages: names(config.configured) })}
                            </p>
                        )}
                {config.uncovered.length > 0 && (onCompose ? (
                    <button
                        type="button" data-testid="kg-apply-v8" style={{ ...primaryButton, whiteSpace: 'normal', padding: '6px 14px' }}
                        onClick={() => onCompose(counted(labels, 'applyV8Request', config.uncovered.length, { packages: config.uncovered.join(', ') }))}
                    >
                        {counted(labels, 'applyV8', config.uncovered.length)}
                    </button>
                ) : <Unavailable labels={labels} label={counted(labels, 'applyV8', config.uncovered.length)} testId="kg-apply-v8-unavailable" />)}
            </Section>
        </>
    );
}
