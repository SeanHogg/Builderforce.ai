/**
 * The ONE right drawer (design prototype `#drawer`): 340px, closed until opened, a tab row — Act first, then every registry panel that is available for this
 * graph in the prototype's order (Coverage, Patterns, API, Simulate, Fix, Review, then Domains and Agent runs where the host has them) — and the open tab's
 * body below. Act's body is the root's (`act`, the ActPanel with its children); every other body is its registry component. At or under the sheet width
 * (`layout.drawerSheet`) it is a bottom sheet over the stage: full width, 55% tall, a top border instead of a left one.
 *
 * It is controlled by `useDrawer` (the open flag and tab), so a card's `onOpenPanel` opens it at that tab and the header's Panels button toggles it.
 */

import type { ReactNode } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { muted } from '../styles';
import type { KnowledgeGraphSource, ViewMode } from '../types';
import { availablePanels } from './PanelDock';
import { DRAWER_ORDER, PANELS } from './panels';
import type { PanelDef, PanelProps, SurfaceEnv } from './registry';
import { ACT_TAB, type DrawerState } from './useDrawer';
import type { SurfaceModel } from './useSurface';
import { DRAWER_WIDTH } from '../layout';
import { chromeGlyph } from './ui/glyphs';
import { PanelChevron } from './ui/PanelChevron';
import { TYPE } from './ui/type';

export interface DrawerProps {
    graph: KnowledgeGraph;
    env: SurfaceEnv;
    labels: KnowledgeGraphLabels;
    surface: SurfaceModel;
    drawer: DrawerState;
    /** The Act tab's body (the root builds it: it owns the findings the cards read). */
    act: ReactNode;
    /** A bottom sheet (a narrow container) instead of a right-hand column. */
    sheet: boolean;
    source?: KnowledgeGraphSource | undefined;
    rootId?: string | undefined;
    rootTitle?: string | undefined;
    onChanged?: (() => void) | undefined;
    diagnostics?: PanelProps['diagnostics'];
    sync?: { status: PanelProps['sync'] } | undefined;
    runs?: PanelProps['runs'];
    reviews?: PanelProps['reviews'];
    lastReviewedAt?: string | undefined;
    history?: PanelProps['history'];
    onResendSkipped?: (() => void) | undefined;
    onCamera?: ((mode: ViewMode) => void) | undefined;
    cameras?: readonly ViewMode[] | undefined;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
    revision?: PanelProps['revision'];
    /** Overrides the registry (tests); the app uses the real one. */
    panels?: readonly PanelDef[];
}

/** The drawer's tabs after Act: the available registry panels, in the prototype's order, then any other available panel. */
export function drawerTabs(graph: KnowledgeGraph, env: SurfaceEnv, panels: readonly PanelDef[] = PANELS): PanelDef[] {
    const ranked = (id: string) => { const i = (DRAWER_ORDER as readonly string[]).indexOf(id); return i < 0 ? DRAWER_ORDER.length : i; };
    return [...availablePanels(graph, env, panels)].sort((a, b) => ranked(a.id) - ranked(b.id));
}

export function Drawer(p: DrawerProps) {
    const { labels, drawer, graph, env } = p;
    if (!drawer.open) return null;
    const tabs = drawerTabs(graph, env, p.panels);
    const open = tabs.find((t) => t.id === drawer.tab) ?? null;
    // A panel this graph does not offer (asked for by id from elsewhere) shows the Act tab rather than an empty body.
    const tabId = open ? open.id : ACT_TAB;
    const Body = open?.component;
    const nameOf = (t: PanelDef) => (t.id === 'run' && p.rootTitle ? p.rootTitle : labels[t.labelKey]);
    const subtitle = open ? (labels.surface.drawerSubtitle as Record<string, string | undefined>)[open.id] : undefined;
    const placement = p.sheet
        ? { position: 'absolute' as const, left: 0, right: 0, bottom: 0, height: '55%', zIndex: 5, borderTop: `1px solid ${cssVar('border')}` }
        : { width: DRAWER_WIDTH, flex: 'none' as const, borderInlineStart: `1px solid ${cssVar('border')}` };
    const tab = (id: string, name: string, on: boolean) => (
        <button
            key={id} type="button" role="tab" id={`kg-drawer-tab-${id}`} aria-selected={on} aria-controls="kg-drawer-body" title={name} aria-label={name} data-tab={id} onClick={() => drawer.pick(id)}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 'calc(var(--kg-control, 40px) + 6px)', padding: '0 8px', border: 0, borderBottom: `2px solid ${on ? cssVar('accent') : 'transparent'}`,
                background: 'none', font: 'inherit', ...TYPE.pill, fontWeight: on ? 700 : 400, color: on ? cssVar('text') : cssVar('muted'), cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none',
            }}
        >
            {chromeGlyph(id)}{on ? name : null}
        </button>
    );
    return (
        <aside
            aria-label={labels.surface.panelsLabel} data-testid="kg-drawer" data-sheet={p.sheet ? 'true' : undefined}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); drawer.close(); } }}
            style={{ ...placement, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, boxSizing: 'border-box', background: cssVar('panel'), color: cssVar('text'), maxWidth: '100%' }}
        >
            <div role="tablist" aria-label={labels.surface.panelsLabel} style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px', borderBottom: `1px solid ${cssVar('border')}`, overflowX: 'auto', scrollbarWidth: 'none', flex: 'none' }}>
                {tab(ACT_TAB, labels.surface.header.drawerTabAct, tabId === ACT_TAB)}
                {tabs.map((t) => tab(t.id, nameOf(t), t.id === tabId))}
                <PanelChevron testId="kg-drawer-close" open side={p.sheet ? 'bottom' : 'right'} label={labels.close} onClick={drawer.close} style={{ marginInlineStart: 'auto' }} />
            </div>
            <div
                id="kg-drawer-body" role="tabpanel" aria-labelledby={`kg-drawer-tab-${tabId}`}
                style={open?.fill ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}
            >
                {tabId === ACT_TAB ? p.act : Body && (
                    <>
                        {!open?.fill && (
                            <h3 style={{ ...TYPE.sectionHeading, flex: 'none' }}>
                                {nameOf(open!)}{subtitle ? <span style={{ ...muted, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}> · {subtitle}</span> : null}
                            </h3>
                        )}
                        <Body
                            graph={graph} source={p.source} rootId={p.rootId} rootTitle={p.rootTitle} onChanged={p.onChanged} diagnostics={p.diagnostics} sync={p.sync?.status} history={p.history}
                            runs={p.runs} reviews={p.reviews} lastReviewedAt={p.lastReviewedAt} onResendSkipped={p.onResendSkipped} onCamera={p.onCamera} cameras={p.cameras} labels={labels}
                            surface={p.surface} onShow={p.onShow} onCompose={p.onCompose} revision={p.revision} onClose={drawer.close}
                        />
                    </>
                )}
            </div>
        </aside>
    );
}
