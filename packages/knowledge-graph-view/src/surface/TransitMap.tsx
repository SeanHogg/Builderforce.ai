/**
 * The transit map (PRD 38, Option B+): layer bands top to bottom, one coloured line per entry
 * point routed through the corridors between bands, stations on the bands. A station's colour,
 * size, ring, pulse and outline come from the overlay bindings; a line's width too. A segment no
 * test reaches is dashed, a finding is a numbered pin, a station on several lines is an
 * interchange, and a line ends in a named data store, outside service or dead end. Documents
 * are square stations with dashed "describes" links. A click opens the station card (go
 * inside, unfold, who calls, API, patterns); unfolding a station is its own state, so the
 * satellites stay when the card closes. This component composes; the pieces live in
 * `transit/`. Colours are tokens, so both themes read; motion only when it is allowed.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { useContainerWidth } from '../environment';
import { COMPACT_WIDTH } from '../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { counted } from './plural';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import { usePanZoom } from '../usePanZoom';
import { usePanZoomRegistration } from './zoom';
import type { LinesModel } from './lines';
import { lineTone, segmentUntested, type OverlayModel } from './overlays';
import type { QuestionId } from './questions';
import type { Station, StationModel } from './stations';
import { OTHER_LAYER } from './transitLayout';
import { buildCard } from './transit/cardModel';
import { DescribeLinks, Satellites } from './transit/DocLinks';
import { HopPath } from './transit/HopPath';
import { StationCard } from './transit/StationCard';
import { StationMark } from './transit/StationMark';
import { terminusText } from './transit/termini';
import { byDepth, TowerMark, towerPinY } from './transit/TowerMark';
import { TerminusMark } from './transit/TerminusMark';
import { bandTitle, TransitBands } from './transit/TransitBands';
import { satelliteBoxes, satellitePlaces, satellitesOf } from './transit/unfold';
import type { EnterCheck } from './transit/useDrill';
import { useCardAnchor } from './transit/useCardAnchor';
import { useTransitLabels } from './transit/useTransitLabels';
import { useTransitModel } from './transit/useTransitModel';
import { FONT_UI, TYPE } from './ui/type';
import type { Pin } from './useSurface';

export interface TransitMapProps {
    stations: StationModel;
    lines: LinesModel;
    overlay: OverlayModel;
    labels: KnowledgeGraphLabels;
    /** Stations that answer the question; null = all. */
    lit: ReadonlySet<string> | null;
    /** The line drawn emphasised (its flow animates). */
    lineId: string | null;
    selectedStation: string | null;
    pins: readonly Pin[];
    /** A lit station's second line of text. Keep it stable (`useCallback`): label placement is redone when it changes. */
    noteOf?: ((s: Station) => string | null) | undefined;
    reducedMotion: boolean;
    onSelectStation(id: string): void;
    onSelectLine(id: string): void;
    label: string;
    /** The title and aria-label of a cycle hop's mark; absent ⇒ the catalog's `surface.cycleHop`. */
    cycleLabel?: string;
    /** The graph the stations were folded from: documents, terminus names, walls, card issues and unfold read it. */
    graph?: KnowledgeGraph | null | undefined;
    /** The bands of a drilled level, top to bottom; absent ⇒ the architecture layers. */
    order?: readonly string[] | undefined;
    /** Stations that are neighbours of a drilled level (they cannot be entered). */
    leaves?: ReadonlySet<string> | undefined;
    /** A line of words over the map (why a level shows files). */
    levelNote?: string | null | undefined;
    question?: QuestionId | undefined;
    /** Definitions are being read (the card says so rather than "no symbols"). */
    loading?: boolean | undefined;
    canEnter?: ((id: string) => EnterCheck) | undefined;
    onEnter?: ((id: string) => void) | undefined;
    onQuestion?: ((id: QuestionId) => void) | undefined;
    onOpenPanel?: ((id: string) => void) | undefined;
    /** `tower` is the same map with each station a 2.5D tower and each line a pipe; absent ⇒ `map`. */
    variant?: 'map' | 'tower' | undefined;
}

const NO_ENTER: EnterCheck = { can: false, reason: 'deepest' };
const NO_LEAVES: ReadonlySet<string> = new Set();

export function TransitMap(p: TransitMapProps) {
    const { stations, lines, overlay, labels, lit, selectedStation, pins, reducedMotion } = p;
    const s = labels.surface;
    const boxRef = useRef<HTMLDivElement>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const width = useContainerWidth(hostRef);
    const compact = width > 0 && width < COMPACT_WIDTH;
    const model = useTransitModel({ graph: p.graph ?? null, stations, lines, overlay, width, order: p.order });
    const { layout } = model;
    // Zoom is the viewBox only (the scene overlay's +, − and Fit): no wheel or drag hook, so the page still scrolls over the map.
    const fitted = useMemo(() => ({ x: 0, y: 0, w: layout.width, h: layout.height }), [layout.width, layout.height]);
    const zoom = usePanZoom(fitted, layout);
    usePanZoomRegistration(zoom);

    // The card and the unfold are two states: the satellites outlive the card that asked for them.
    const [cardId, setCardId] = useState<string | null>(null);
    const [unfoldedId, setUnfoldedId] = useState<string | null>(null);
    const cardIdRef = useRef(cardId);
    cardIdRef.current = cardId;
    const anchor = useCardAnchor(boxRef, hostRef, cardRef, cardId, cardId !== null && cardId === unfoldedId, [zoom.viewBox, layout.width, layout.height]);

    const focusStation = useCallback((id: string) => {
        ([...(hostRef.current?.querySelectorAll('[data-station]') ?? [])].find((el) => el.getAttribute('data-station') === id) as SVGElement | undefined)?.focus({ preventScroll: true });
    }, []);
    const closeCard = useCallback(() => {
        const id = cardIdRef.current;
        setCardId(null);
        if (id) focusStation(id);
    }, [focusStation]);

    // A station that left the map (a level was entered, the graph changed) takes its card and its unfold with it.
    useEffect(() => {
        if (cardId && (anchor.missing || !stations.byId.has(cardId))) setCardId(null);
        if (unfoldedId && !stations.byId.has(unfoldedId)) setUnfoldedId(null);
    }, [anchor.missing, cardId, unfoldedId, stations.byId]);
    // Escape with the satellites out and no card open folds them.
    useEffect(() => {
        if (!unfoldedId || cardId) return;
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setUnfoldedId(null); };
        document.addEventListener('keydown', key);
        return () => document.removeEventListener('keydown', key);
    }, [unfoldedId, cardId]);

    // A compact card is a bottom sheet on the view's own frame, like the other sheets.
    const [frame, setFrame] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => setFrame(boxRef.current?.closest('section') ?? null), []);

    const lineById = useMemo(() => new Map(lines.lines.map((l) => [l.id, l] as const)), [lines.lines]);
    const dim = (...ids: string[]) => lit !== null && !ids.every((id) => lit.has(id));
    const layerName = (layer: string) => bandTitle(layer, labels);
    const pinOf = new Map(pins.map((pin) => [pin.stationId, pin.count] as const));
    const undrawn = stations.stations.length - layout.drawn.length;
    const claims = p.question === 'claims';
    const tower = p.variant === 'tower';
    const Mark = tower ? TowerMark : StationMark;
    const marked = useMemo(() => (tower ? byDepth(model.drawn, layout.positions) : model.drawn), [tower, model.drawn, layout.positions]);

    // Unfold: the satellites of the unfolded station, which labels and the card keep clear of.
    const unfoldStation = unfoldedId ? stations.byId.get(unfoldedId) : undefined;
    const unfoldAt = unfoldStation ? layout.positions.get(unfoldStation.id) : undefined;
    const satellites = useMemo(() => (unfoldStation ? satellitesOf(unfoldStation, model.index) : []), [unfoldStation, model.index]);
    const places = useMemo(() => (unfoldAt ? satellitePlaces(unfoldAt, satellites.length, unfoldAt.y > layout.height / 2) : []), [unfoldAt, satellites, layout.height]);
    const obstacles = useMemo(() => [...model.obstacles, ...satelliteBoxes(places, satellites)], [model.obstacles, places, satellites]);
    const { placed, notes } = useTransitLabels({
        drawn: model.drawn, positions: layout.positions, styles: model.styles, lit, noteOf: p.noteOf, selectedStation, labels,
        width: layout.width, height: layout.height, obstacles, tower,
    });

    const cardStation = cardId ? stations.byId.get(cardId) : undefined;
    const cardSatellites = cardStation ? (cardStation.id === unfoldedId ? satellites : satellitesOf(cardStation, model.index)) : [];
    const leaves = p.leaves ?? NO_LEAVES;
    const open = (id: string) => { p.onSelectStation(id); setCardId(id); };
    // Choosing the unfolded station again folds it; choosing one of its satellites opens its card and leaves them out.
    const pick = (id: string) => { open(id); if (id === unfoldedId) setUnfoldedId(null); };
    // Every action closes the card and hands focus back to the station it was about.
    const act = (id: string, run: () => void) => { run(); setCardId(null); focusStation(id); };

    const cardNode = cardStation && (
        <StationCard
            key={cardStation.id}
            card={buildCard({
                station: cardStation, stations: stations.stations, labels, layerName: layerName(cardStation.layer ?? OTHER_LAYER), findings: model.findings, index: model.index,
                enter: p.canEnter?.(cardStation.id) ?? NO_ENTER, satellites: cardSatellites.length, unfolded: unfoldedId === cardStation.id, leaf: leaves.has(cardStation.id),
            })}
            labels={labels} compact={compact} at={anchor} boxRef={cardRef} loading={p.loading} onClose={closeCard}
            onEnter={() => act(cardStation.id, () => { setUnfoldedId(null); p.onEnter?.(cardStation.id); })}
            onUnfold={() => setUnfoldedId((cur) => (cur === cardStation.id ? null : cardStation.id))}
            onCallers={() => act(cardStation.id, () => p.onQuestion?.('callers'))}
            onApi={() => act(cardStation.id, () => p.onOpenPanel?.('api'))}
            onPatterns={() => act(cardStation.id, () => p.onOpenPanel?.('patterns'))}
        />
    );

    return (
        <div ref={boxRef} style={{ position: 'relative', width: '100%' }}>
            <div ref={hostRef} data-testid="kg-transit" style={{ position: 'relative', width: '100%', overflow: 'auto' }}>
                <svg
                    role="group" aria-label={p.label} width={layout.width} height={layout.height} viewBox={zoom.viewBox ?? `0 0 ${layout.width} ${layout.height}`}
                    // Wider than the container: scroll sideways at full size rather than shrink the labels to a few pixels.
                    style={{ display: 'block', maxWidth: width > 0 && layout.width > width ? 'none' : '100%', color: cssVar('text') }}
                >
                    <desc>{fillTemplate(s.mapDescription, { lines: counted(labels, 'line', lines.lines.length), stations: counted(labels, 'station', layout.drawn.length) })}</desc>
                    <TransitBands bands={layout.bands} width={layout.width} walls={model.walls} labels={labels} />
                    <DescribeLinks routes={model.describes} emphasised={claims} label={s.map.describes} />

                    {layout.routes.map((r) => {
                        const line = lineById.get(r.lineId)!;
                        const from = stations.byId.get(r.from), to = stations.byId.get(r.to);
                        const untested = from && to ? segmentUntested(from, to) === true : false;
                        const off = dim(r.from, r.to);
                        return (
                            <HopPath
                                key={`${r.lineId}:${r.index}`} route={r} color={cssVar(lineTone(line.colourIndex))} width={model.widths.get(r.lineId) ?? 6} untested={untested}
                                cycle={line.hops[r.index]?.cycle === true} dim={off} cycleLabel={p.cycleLabel ?? s.cycleHop} pipe={tower} onSelect={() => p.onSelectLine(r.lineId)}
                                flowing={!reducedMotion && !off && !untested && r.lineId === p.lineId}
                            />
                        );
                    })}

                    {model.termini.map(({ info, at, from }) => (
                        <TerminusMark
                            key={`t:${info.stationId}`} glyph={info.glyph} kind={info.kind} from={from} at={at} text={terminusText(info, labels)} dim={dim(info.stationId)}
                            lines={info.lineIds.map((id) => ({ color: cssVar(lineTone(lineById.get(id)?.colourIndex ?? 0)), width: model.widths.get(id) ?? 6 }))}
                        />
                    ))}

                    {unfoldStation && unfoldAt && (
                        <Satellites
                            center={unfoldAt} items={satellites} places={places} color={cssVar(model.styles.get(unfoldStation.id)?.tone ?? 'edge')}
                            parentName={unfoldStation.name} ariaTemplate={s.map.satelliteAria} onSelect={() => open(unfoldStation.id)}
                        />
                    )}

                    {marked.map((station) => {
                        const pos = layout.positions.get(station.id), label = placed.get(station.id), style = model.styles.get(station.id);
                        if (!pos || !label || !style) return null;
                        const inter = lines.interchanges.get(station.id);
                        return (
                            <Mark
                                key={station.id} id={station.id} at={pos} style={style} selected={station.id === selectedStation} dim={dim(station.id)}
                                doc={model.docs.has(station.id)} interchange={inter ? counted(labels, 'interchange', inter.length) : null} label={label}
                                aria={fillTemplate(s.stationAria, { name: station.name, layer: layerName(station.layer ?? OTHER_LAYER), files: counted(labels, 'file', station.files) })}
                                accentNote={notes.get(station.id)?.accent === true} reducedMotion={reducedMotion} complexity={station.cx} onActivate={() => pick(station.id)}
                            />
                        );
                    })}

                    {model.drawn.filter((station) => pinOf.has(station.id)).map((station) => {
                        const pos = layout.positions.get(station.id)!;
                        const style = model.styles.get(station.id);
                        const r = style?.size ?? 8;
                        const cx = pos.x + r + 8, cy = tower && style ? towerPinY(pos, style, station.cx) : pos.y - r - 8;
                        const activate = () => pick(station.id);
                        return (
                            <g
                                key={`pin:${station.id}`} role="button" tabIndex={0} data-pin={station.id} style={{ cursor: 'pointer' }}
                                aria-label={counted(labels, 'pinFindings', pinOf.get(station.id)!, { name: station.name })}
                                onClick={activate} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
                            >
                                <circle cx={cx} cy={cy} r={11} fill={cssVar(`sev${station.anti}` as ThemeTone)} stroke={cssVar('bg')} strokeWidth={1.5} />
                                <text x={cx} y={cy + 4} textAnchor="middle" fontFamily={FONT_UI} fontSize={TYPE.status.fontSize} fontWeight={TYPE.status.fontWeight} fill={cssVar('bg')}>{pinOf.get(station.id)}</text>
                            </g>
                        );
                    })}
                </svg>
                {p.levelNote && <p data-level-note style={{ margin: 0, padding: '4px 12px', ...TYPE.bodyMuted }}>{p.levelNote}</p>}
                {undrawn > 0 && <p style={{ margin: 0, padding: '4px 12px', ...TYPE.bodyMuted }}>{counted(labels, 'moreStations', undrawn)}</p>}
                {layout.hiddenOnLine > 0 && <p data-more-stops style={{ margin: 0, padding: '4px 12px', ...TYPE.bodyMuted }}>{counted(labels, 'moreStops', layout.hiddenOnLine)}</p>}
            </div>
            {compact && frame && cardNode ? createPortal(cardNode, frame) : cardNode}
        </div>
    );
}
