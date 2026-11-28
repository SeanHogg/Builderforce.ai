/**
 * The station card on the stage (PRD 43 B3 Cards, B7): the map's own `StationCard` (the ONE note-card shell) and
 * `buildCard`, docked at the stage's top-left. Its actions run on the stage: Go inside is the semantic zoom's shortcut
 * (`onEnter`: the camera flies into the station and the zoom crossing drills), Unfold patches the placement, Who calls /
 * API / Patterns hand over to the surface. The card closes with the selection (Escape, a click on empty space, a drill
 * step). Reads only main-thread data (the stations, the graph's index and findings).
 */

import { useMemo, type ReactNode } from 'react';
import type { Finding, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { nodeIndex } from '../../graphModel';
import type { KnowledgeGraphLabels } from '../../labels';
import type { MarkType } from '../../shapes';
import { bandTitle } from '../../surface/bands';
import type { QuestionId } from '../../surface/questions';
import type { SymbolFacts } from '../../surface/symbolFacts';
import { buildCard, type CardModel } from '../../surface/transit/cardModel';
import type { Station } from '../../surface/stations';
import type { NoteAnswer } from '../../surface/transit/NoteCard';
import { StationCard } from '../../surface/transit/StationCard';
import type { DrillModel } from '../../surface/transit/useDrill';
import { OTHER_LAYER } from '../../surface/transitLayout';
import type { StageMap } from '../drill/useStageMap';

export interface StageCardProps {
    /** The open card's slot key (a station at the current level); null = no card. */
    cardKey: string | null;
    map: StageMap;
    drill: DrillModel;
    graph: KnowledgeGraph;
    labels: KnowledgeGraphLabels;
    /** The stage box is narrow (≤ 900px). */
    narrow: boolean;
    /** The station's mark type (its glyph and kind). */
    type: MarkType;
    /** The answer to the question being asked. */
    answer?: NoteAnswer | null | undefined;
    onQuestion?: ((id: QuestionId) => void) | undefined;
    onCallers?: (() => void) | undefined;
    callersActive?: boolean | undefined;
    callersDetail?: ReactNode;
    onOpenPanel?: ((id: string) => void) | undefined;
    /** Go inside as the semantic zoom's shortcut (B1a rule 9: fly to the station, the zoom enters it); absent = drill directly. */
    onEnter?: ((stationId: string) => void) | undefined;
    /** Opens the docked code panel on this mark. Absent ⇒ no Code button. */
    onCode?: (() => void) | undefined;
    /** The graph's facts, computed once by the wiring (test reach, anti-pattern); absent ⇒ no facts row, no Restructure. */
    facts?: SymbolFacts | undefined;
    /** Opens the path simulator through this station. Absent ⇒ no Simulate button. */
    onSimulate?: (() => void) | undefined;
    /** Opens the restructure compare for this station's anti-pattern (replaces Simulate). Absent ⇒ no Restructure button. */
    onRestructure?: (() => void) | undefined;
    /** False while the restructure's file is being read: Restructure shows disabled. Default true. */
    restructureReady?: boolean | undefined;
}

const NO_ENTER = { can: false, reason: 'deepest' } as const;

/** What the station card says about `station` (also the code pane's plain-words box). */
export function stationCardOf(
    station: Station,
    c: { map: StageMap; drill: DrillModel; findings: ReadonlyMap<string, Finding>; index: ReadonlyMap<string, KNode>; labels: KnowledgeGraphLabels; facts?: SymbolFacts | undefined; restructureReady?: boolean | undefined },
): CardModel {
    return buildCard({
        station, stations: c.map.stations.stations, labels: c.labels, layerName: bandTitle(station.layer ?? OTHER_LAYER, c.labels), findings: c.findings, index: c.index,
        enter: c.drill.canEnter?.(station.id) ?? NO_ENTER, satellites: c.map.satellites(station), unfolded: c.map.unfolded === station.id, leaf: c.drill.view?.leaves.has(station.id) ?? false,
        facts: c.facts, restructureReady: c.restructureReady,
    });
}

export function StageCard({ cardKey, map, drill, graph, labels, narrow, type, answer, onQuestion, onCallers, callersActive, callersDetail, onOpenPanel, onEnter, onCode, facts, onSimulate, onRestructure, restructureReady }: StageCardProps) {
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const findings = useMemo(() => new Map(graph.findings.map((f) => [f.id, f] as const)), [graph]);
    const station = map.stationOfKey(cardKey);
    if (!station || !cardKey) return null;
    const base = stationCardOf(station, { map, drill, findings, index, labels, facts, restructureReady });
    const card: CardModel = base.leaf && onEnter ? { ...base, enter: { can: true, level: 'package', ref: station.id } } : base;
    return (
        <StationCard
            key={station.id} card={card} labels={labels} type={type} answer={answer} narrow={narrow} loading={drill.loading}
            onEnter={() => (onEnter ?? drill.enter)(station.id)}
            onUnfold={() => map.toggleUnfold(station.id)}
            onCallers={onCallers ?? (() => onQuestion?.('callers'))} callersActive={callersActive} callersDetail={callersDetail}
            onApi={() => onOpenPanel?.('api')}
            onPatterns={() => onOpenPanel?.('patterns')}
            onCode={onCode}
            onSimulate={onSimulate}
            onRestructure={onRestructure}
        />
    );
}
