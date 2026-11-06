// @vitest-environment jsdom
/** The surface's parts, one by one: the transit map, path strip, lines panel, Act panel, overlay menu, panel dock and the registries. */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { codeFixture, expandAllFindings, surfaceFixture } from '../testing';
import { ActPanel } from './ActPanel';
import { CAMERAS } from './cameras';
import { LinesPanel } from './LinesPanel';
import { buildLines } from './lines';
import { OverlayMenu } from './OverlayMenu';
import { makeOverlay, PRESETS } from './overlays';
import { PanelDrawer, PanelToggle } from './PanelDock';
import { pathOfLine } from './path';
import { PathStrip } from './PathStrip';
import { PANELS } from './panels';
import type { PanelDef, SurfaceEnv } from './registry';
import { buildStations } from './stations';
import { TransitMap } from './TransitMap';

const graph = surfaceFixture();
const model = buildStations(graph);
const lines = buildLines(graph, model);
const overlay = makeOverlay(PRESETS.risk, model.stations);
const id = (name: string) => model.stations.find((s) => s.name === name)!.id;
const env: SurfaceEnv = { webgl: false, reducedMotion: true, hasLines: true, compact: false };

function map(over: Partial<Parameters<typeof TransitMap>[0]> = {}) {
    const props = {
        stations: model, lines, overlay, labels: L, lit: null, lineId: lines.lines[0]!.id, selectedStation: null, pins: [], reducedMotion: true,
        onSelectStation: vi.fn(), onSelectLine: vi.fn(), label: 'map', ...over,
    };
    return { props, ...render(<TransitMap {...props} />) };
}

describe('TransitMap', () => {
    it('draws a button per station that selects it', () => {
        const { props } = map();
        const api = screen.getByRole('button', { name: fillTemplate(L.surface.stationAria, { name: 'API', layer: L.surface.layers.presentation, files: 2 }) });
        fireEvent.click(api);
        expect(props.onSelectStation).toHaveBeenCalledWith(id('API'));
        fireEvent.keyDown(api, { key: 'Enter' });
        expect(props.onSelectStation).toHaveBeenCalledTimes(2);
    });

    it('draws bands, a route per hop, interchange titles and a terminus per line', () => {
        const { container } = map();
        expect(container.querySelectorAll('[data-line]').length).toBe(lines.lines.reduce((n, l) => n + l.hops.length, 0));
        expect(container.querySelectorAll('[data-terminus="data"]')).toHaveLength(2);
        expect(screen.getByText(L.surface.layers.entry.toUpperCase())).toBeTruthy();
        expect(container.querySelector(`[data-station="${id('API')}"] title`)?.textContent).toBe(fillTemplate(L.surface.interchange, { count: 2 }));
    });

    it('dashes only the segments no test reaches, and only where coverage exists', () => {
        const { container } = map();
        const untested = [...container.querySelectorAll('[data-untested]')];
        expect(untested.length).toBeGreaterThan(0);
        // main.tsx -> Web app has no coverage anywhere on it: never dashed.
        expect(container.querySelectorAll('[data-line="line:1"]')[0]!.hasAttribute('data-untested')).toBe(false);
    });

    it('pins findings to their station, and the pin selects it', () => {
        const { props } = map({ pins: [{ stationId: id('API'), count: 2 }] });
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(L.surface.pinAria, { count: 2, name: 'API' }) }));
        expect(props.onSelectStation).toHaveBeenCalledWith(id('API'));
    });

    it('dims stations the question does not light, and shows notes of the lit ones', () => {
        const { container } = map({ lit: new Set([id('API')]), noteOf: (s) => (s.name === 'API' ? 'a note' : null) });
        expect(container.querySelector(`[data-station="${id('API')}"]`)!.getAttribute('opacity')).toBe('1');
        expect(container.querySelector(`[data-station="${id('cron')}"]`)!.getAttribute('opacity')).toBe('0.4');
        expect(screen.getByText('a note')).toBeTruthy();
    });

    it('animates the flow and pulse only when motion is allowed', () => {
        const still = map({ reducedMotion: true });
        expect(still.container.querySelector('animate')).toBeNull();
        still.unmount();
        const moving = map({ reducedMotion: false });
        expect(moving.container.querySelector('animate')).not.toBeNull();
    });
});

describe('PathStrip', () => {
    const path = pathOfLine(lines.lines[0]!, model.byId);

    it('lists the stops with the edge between each pair and steps', () => {
        const onStep = vi.fn();
        render(<PathStrip path={path} step={1} labels={L} onStep={onStep} />);
        expect(screen.getAllByText(/references · 1/)).toHaveLength(3);
        expect(screen.getByRole('button', { name: 'Web app' }).getAttribute('aria-current')).toBe('step');
        fireEvent.click(screen.getByRole('button', { name: L.surface.pathNext }));
        expect(onStep).toHaveBeenCalledWith(2);
        fireEvent.click(screen.getByRole('button', { name: L.surface.pathBack }));
        expect(onStep).toHaveBeenCalledWith(0);
        fireEvent.click(screen.getByRole('button', { name: 'API' }));
        expect(onStep).toHaveBeenCalledWith(2);
    });

    it('disables stepping past either end and says when there is no path', () => {
        const { rerender } = render(<PathStrip path={path} step={0} labels={L} onStep={() => undefined} />);
        expect((screen.getByRole('button', { name: L.surface.pathBack }) as HTMLButtonElement).disabled).toBe(true);
        rerender(<PathStrip path={path} step={3} labels={L} onStep={() => undefined} />);
        expect((screen.getByRole('button', { name: L.surface.pathNext }) as HTMLButtonElement).disabled).toBe(true);
        rerender(<PathStrip path={{ stops: [], hops: [] }} step={0} labels={L} onStep={() => undefined} />);
        expect(screen.getByText(L.surface.pathEmpty)).toBeTruthy();
    });
});

describe('LinesPanel', () => {
    const base = { lines, stations: model, overlay, labels: L, lineId: lines.lines[0]!.id, selectedStation: null, onSelectLine: vi.fn(), onSelectStation: vi.fn() };

    it('lists the lines and the stations of the selected one', () => {
        render(<LinesPanel {...base} />);
        fireEvent.click(screen.getByRole('button', { name: new RegExp(fillTemplate(L.surface.lineName, { name: 'cron' })) }));
        expect(base.onSelectLine).toHaveBeenCalledWith(lines.lines[1]!.id);
        const rows = document.querySelectorAll('[data-station-row]');
        expect(rows).toHaveLength(4);
        fireEvent.click(rows[2]!);
        expect(base.onSelectStation).toHaveBeenCalledWith(id('API'));
    });

    it('states a legend row per channel, and which are not set up', () => {
        const bare = buildStations(codeFixture());
        render(<LinesPanel {...base} lines={{ lines: [], interchanges: new Map(), omitted: 2 }} stations={bare} overlay={makeOverlay(PRESETS.risk, bare.stations)} lineId={null} />);
        expect(screen.getByText(L.surface.linesEmpty)).toBeTruthy();
        expect(screen.getByText(fillTemplate(L.surface.omittedLines, { count: 2 }))).toBeTruthy();
        const legend = within(screen.getByTestId('kg-surface-legend'));
        expect(legend.getByText(new RegExp(fillTemplate(L.surface.legendRow, { channel: L.surface.channels.size, metric: L.surface.metricNames.cx })))).toBeTruthy();
        expect(document.querySelectorAll('[data-status="not-set-up"]').length).toBeGreaterThan(0);
        expect(legend.queryByText(new RegExp(L.surface.channels.outline))).toBeNull();
    });
});

describe('ActPanel', () => {
    const act = (over: Partial<Parameters<typeof ActPanel>[0]> = {}) => render(
        <ActPanel
            graph={graph} findings={graph.findings} labels={L} station={null} stations={model.stations} scopeName={null} compact={false}
            onClearScope={vi.fn()} onShow={vi.fn()} onCompose={vi.fn()} {...over}
        />,
    );

    it('badges every finding with its provenance and keeps Fix with agent', () => {
        const onCompose = vi.fn();
        act({ onCompose });
        const aside = document.querySelector(`aside[aria-label="${L.findingsTitle}"]`)!;
        expandAllFindings({ fireEvent }, aside);
        expect(aside.querySelectorAll('[data-provenance="deterministic"]')).toHaveLength(2);
        fireEvent.click(within(aside.querySelector('[data-finding="clone-group"]') as HTMLElement).getByRole('button', { name: L.fixWithAgent }));
        expect(onCompose).toHaveBeenCalledTimes(1);
    });

    it('names its scope, clears it, and shows a station with not-set-up metrics', () => {
        const onClearScope = vi.fn(), onShow = vi.fn();
        const web = model.stations.find((s) => s.name === 'Web app')!;
        act({ scopeName: 'Web app', station: web, onClearScope, onShow });
        expect(screen.getByText(fillTemplate(L.surface.actScope, { scope: 'Web app' }))).toBeTruthy();
        const facts = within(screen.getByTestId('kg-station-facts'));
        expect(facts.getAllByText(L.surface.notSetUp).length).toBeGreaterThan(0);
        fireEvent.click(facts.getByRole('button', { name: L.surface.showFiles }));
        expect(onShow).toHaveBeenCalledWith(web.refs);
        fireEvent.click(screen.getByRole('button', { name: L.surface.actScopeAll }));
        expect(onClearScope).toHaveBeenCalled();
    });

    it('omits the findings where the list already shows them', () => {
        act({ showFindings: false });
        expect(screen.queryByText(L.findingsTitle)).toBeNull();
    });
});

describe('OverlayMenu', () => {
    const open = () => {
        const p = { onPreset: vi.fn(), onChannel: vi.fn(), onPins: vi.fn() };
        render(<OverlayMenu labels={L} stations={model.stations} bindings={PRESETS.risk} preset="risk" {...p} />);
        fireEvent.click(screen.getByRole('button', { name: `${fillTemplate(L.surface.presetLabel, { preset: L.surface.presets.risk })} ▾` }));
        return p;
    };

    it('picks a preset, a channel metric and the pins', () => {
        const p = open();
        const menu = within(screen.getByTestId('kg-overlay-menu'));
        fireEvent.click(menu.getByRole('button', { name: L.surface.presets.quality }));
        expect(p.onPreset).toHaveBeenCalledWith('quality');
        fireEvent.click(within(menu.getByRole('group', { name: L.surface.channels.colour })).getByRole('button', { name: L.surface.metricNames.cov }));
        expect(p.onChannel).toHaveBeenCalledWith('colour', 'cov');
        fireEvent.click(within(menu.getByRole('group', { name: L.surface.channels.pins })).getByRole('button', { name: L.surface.off }));
        expect(p.onPins).toHaveBeenCalledWith(false);
    });

    it('offers owner only as a colour and marks a metric with no data', () => {
        render(<OverlayMenu labels={L} stations={buildStations(codeFixture()).stations} bindings={PRESETS.risk} preset="risk" onPreset={vi.fn()} onChannel={vi.fn()} onPins={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { expanded: false }));
        const menu = within(screen.getByTestId('kg-overlay-menu'));
        expect(within(menu.getByRole('group', { name: L.surface.channels.size })).queryByText(new RegExp(L.surface.metricNames.owner))).toBeNull();
        expect(within(menu.getByRole('group', { name: L.surface.channels.colour })).getByText(`${L.surface.metricNames.owner} · ${L.surface.notSetUp}`)).toBeTruthy();
    });

    it('closes on Escape', () => {
        open();
        fireEvent.keyDown(screen.getByTestId('kg-overlay-menu'), { key: 'Escape' });
        expect(screen.queryByTestId('kg-overlay-menu')).toBeNull();
    });

    it('explains that any metric can drive any channel, in a dialog', () => {
        open();
        expect(screen.getByRole('dialog', { name: L.surface.overlaysTitle })).toBeTruthy();
        expect(screen.getByText(L.surface.header.overlaysNote)).toBeTruthy();
    });

    it('on a narrow container the trigger is the short preset name', () => {
        render(<OverlayMenu labels={L} stations={model.stations} bindings={PRESETS.risk} preset="risk" onPreset={vi.fn()} onChannel={vi.fn()} onPins={vi.fn()} narrow />);
        expect(screen.getByRole('button', { name: `${L.surface.presets.risk} ▾` })).toBeTruthy();
    });
});

describe('registries', () => {
    it('orders the cameras and gates them on the environment', () => {
        expect(CAMERAS.map((c) => c.id)).toEqual(['transit', 'system', 'graph', 'map', '3d', 'heat', 'sequence', 'list']);
        const ids = (e: Partial<SurfaceEnv>) => CAMERAS.filter((c) => c.available(graph, { ...env, ...e })).map((c) => c.id);
        expect(ids({})).toEqual(['transit', 'system', 'graph', 'map', 'heat', 'sequence', 'list']);
        expect(ids({ hasLines: false })).toEqual(['system', 'graph', 'map', 'heat', 'list']);
        expect(ids({ webgl: true })).toContain('3d');
    });

    it('holds the six drawers, and a toggle with no panel available draws nothing', () => {
        expect(PANELS.map((p) => p.id)).toEqual(['sync', 'coverage', 'patterns', 'api', 'resolve', 'simulate']);
        const { container } = render(<PanelToggle graph={graph} env={env} labels={L} panel={null} onPanel={vi.fn()} panels={[]} />);
        expect(container.innerHTML).toBe('');
    });

    it('the header shows Coverage, Patterns, API, Sync in that order; Resolve and Simulate have no button', () => {
        const all = PANELS.map((p) => ({ ...p, available: () => true }));
        render(<PanelToggle graph={graph} env={env} labels={L} panel={null} onPanel={vi.fn()} panels={all} />);
        const names = within(screen.getByRole('group', { name: L.surface.panelsLabel })).getAllByRole('button').map((b) => b.textContent);
        expect(names).toEqual([L.panelCoverage, L.panelPatterns, L.panelApi, L.panelSync]);
    });

    it('draws a button and a controlled drawer (with its subtitle) for each available panel row', () => {
        const Body = () => <p>panel body</p>;
        const panels: PanelDef[] = [
            { id: 'sync', labelKey: 'viewList', component: Body, available: () => true },
            { id: 'hidden', labelKey: 'viewGraph', component: Body, available: () => false },
        ];
        function Harness() {
            const [panel, setPanel] = useState<string | null>(null);
            return (
                <>
                    <PanelToggle graph={graph} env={env} labels={L} panel={panel} onPanel={setPanel} panels={panels} ids={['sync', 'hidden']} />
                    <PanelDrawer graph={graph} env={env} labels={L} surface={{} as never} panel={panel} onPanel={setPanel} onShow={vi.fn()} panels={panels} />
                </>
            );
        }
        render(<Harness />);
        expect(screen.queryByRole('button', { name: L.viewGraph })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: L.viewList }));
        expect(screen.getByText('panel body')).toBeTruthy();
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(screen.getByText(L.surface.drawerSubtitle.sync)).toBeTruthy();
        // Pressing the open panel's button closes the drawer again.
        fireEvent.click(screen.getByRole('button', { name: L.viewList }));
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
