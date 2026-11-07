/**
 * The Act rail's cards: up to three action cards (pin, title, detail, Apply / Prompt / Show, and where
 * the finding came from), the empty-state check card, and the compact system-wide block. Pins carry the
 * finding's place in `graph.findings` (`pinNumbers`), the number the left rail shows beside its station.
 */

import type { CSSProperties } from 'react';
import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { findingDetail, findingItems, findingRequest, findingTitle } from '../findingText';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import { button } from '../styles';
import type { ActionCard, FindingSource } from './actModel';
import { Card, Chip, Pin } from './ui';
import { TYPE } from './ui/type';

const SOURCE_TONE: Record<FindingSource, ThemeTone> = { exact: 'agrees', analyzer: 'accent', model: 'cycle' };

/** Where a card's finding comes from: exact / analyzer / model. */
export function SourceChip({ source, labels }: { source: FindingSource; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.act;
    return <Chip tone={SOURCE_TONE[source]} data-source={source}>{source === 'exact' ? t.sourceExact : source === 'analyzer' ? t.sourceAnalyzer : t.sourceModel}</Chip>;
}

/** A small rounded action button. */
export const smallButton: CSSProperties = { ...button, ...TYPE.pill, minHeight: `calc(var(--kg-control, 40px) - 4px)`, minWidth: 0, padding: '0 10px', borderRadius: 999 };

export interface CardsProps {
    cards: ActionCard[];
    labels: KnowledgeGraphLabels;
    index: ReadonlyMap<string, KNode>;
    /** finding id → pin number (`pinNumbers(graph.findings)`). */
    pins: ReadonlyMap<string, number>;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
    onResolve?: ((f: Finding) => void) | undefined;
}

export function Cards({ cards, labels, index, pins, onShow, onCompose, onResolve }: CardsProps) {
    const t = labels.surface.act;
    const act = (action: string, title: string) => fillTemplate(t.cardAction, { action, title });
    return (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }} aria-label={t.cardsTitle}>
            {cards.map(({ finding: f, level, source, canApply }, i) => {
                const title = findingTitle(f, labels);
                return (
                    <Card as="li" key={f.id} style={{ display: 'grid', gap: 6 }}>
                        <div data-card={f.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <Pin n={pins.get(f.id) ?? i + 1} level={level} />
                            <strong style={{ ...TYPE.bodyLarge, fontWeight: 700, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{title}</strong>
                            <SourceChip source={source} labels={labels} />
                        </div>
                        <p style={{ ...TYPE.monoMeta, margin: 0, overflowWrap: 'anywhere' }}>{findingDetail(f, labels, index) ?? findingItems(f, index)}</p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {canApply && onResolve && (
                                <button type="button" data-act="apply" aria-label={act(t.apply, title)} style={{ ...smallButton, background: cssVar('accent'), color: cssVar('onAccent'), borderColor: cssVar('accent') }} onClick={() => onResolve(f)}>{t.apply}</button>
                            )}
                            {onCompose && (
                                <button type="button" data-act="prompt" aria-label={act(t.prompt, title)} style={smallButton} onClick={() => onCompose(findingRequest(f, labels, index))}>{t.prompt}</button>
                            )}
                            <button type="button" data-act="show" aria-label={act(t.show, title)} style={smallButton} onClick={() => onShow([...f.nodes])}>{t.show}</button>
                        </div>
                    </Card>
                );
            })}
        </ol>
    );
}

export interface EmptyCardProps {
    labels: KnowledgeGraphLabels;
    /** A station is selected (else the drawn path). */
    atStation: boolean;
    onAsk(): void;
    onShow(): void;
}

/** Nothing to act on here: a check mark, what that means, and the next question to ask. */
export function EmptyCard({ labels, atStation, onAsk, onShow }: EmptyCardProps) {
    const t = labels.surface.act;
    return (
        <Card as="section" label={t.emptyTitle} style={{ display: 'grid', gap: 6 }}>
            <div data-testid="kg-act-empty" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden="true" style={{ ...TYPE.status, flex: 'none', width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center', background: cssVar('agrees'), color: cssVar('bg') }}>✓</span>
                <strong style={{ ...TYPE.bodyLarge, fontWeight: 700 }}>{t.emptyTitle}</strong>
            </div>
            <p style={{ ...TYPE.body, margin: 0 }}>{atStation ? t.emptyStation : t.emptyPath}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" data-act="ask-untested" style={smallButton} onClick={onAsk}>{t.emptyAsk}</button>
                <button type="button" data-act="empty-show" style={{ ...smallButton, border: 0, background: 'transparent', color: cssVar('accent') }} onClick={onShow}>{t.emptyShow}</button>
            </div>
        </Card>
    );
}

/** The findings that touch most of the system: one compact block, never a count on a single station. */
export function SystemWideBlock({ findings, labels, onShow }: { findings: readonly Finding[]; labels: KnowledgeGraphLabels; onShow(refs: string[]): void }) {
    const t = labels.surface.act;
    return (
        <Card as="section" label={fillTemplate(t.systemWide, { count: findings.length })} style={{ display: 'grid', gap: 4 }}>
            <div data-testid="kg-act-system-wide" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ ...TYPE.subtitle, flex: 1 }}>{fillTemplate(t.systemWide, { count: findings.length })}</strong>
                <button type="button" data-act="system-wide-show" style={{ ...smallButton, border: 0, background: 'transparent', color: cssVar('accent') }} onClick={() => onShow(findings.flatMap((f) => f.nodes))}>{t.show}</button>
            </div>
            <ul style={{ ...TYPE.body, margin: 0, paddingInlineStart: 16 }}>
                {findings.map((f) => <li key={f.id}>{findingTitle(f, labels)}</li>)}
            </ul>
            <p style={{ ...TYPE.meta, margin: 0 }}>{t.systemWideNote}</p>
        </Card>
    );
}
