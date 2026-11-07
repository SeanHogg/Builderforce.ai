/**
 * The panel registry: drawers opened from the header's panel buttons. A panel is one row
 * `{ id, labelKey, component, available }`; the header, the sheet and the compact (bottom
 * sheet) behaviour follow with no edit to the root. Each drawer reads only what it needs and
 * says "not set up" when the data behind it was never collected.
 */

import { ApiPanel } from './drawers/ApiPanel';
import { CoveragePanel } from './drawers/CoveragePanel';
import { PatternsPanel } from './drawers/PatternsPanel';
import { ResolvePanel } from './drawers/ResolvePanel';
import { SimulatePanel } from './drawers/SimulatePanel';
import { SyncPanel } from './drawers/SyncPanel';
import type { PanelDef } from './registry';
import { RunPanel } from './run/RunPanel';

export type PanelId = 'sync' | 'run' | 'coverage' | 'patterns' | 'api' | 'resolve' | 'simulate';

/**
 * The panels that have a button in the header's "Panels" group, in order. Resolve and Simulate
 * stay in the registry (the Act rail and the path strip open them with `openPanel`).
 */
export const HEADER_PANELS: readonly PanelId[] = ['coverage', 'patterns', 'api', 'sync'];

export const PANELS: readonly (PanelDef & { id: PanelId })[] = [
    { id: 'sync', labelKey: 'panelSync', component: SyncPanel, available: (_graph, env) => env.hasSync === true },
    // Opened by the review controls, the sync pill and the review card's Details; it has no header button.
    { id: 'run', labelKey: 'panelRun', component: RunPanel, available: (_graph, env) => env.hasRun === true },
    { id: 'coverage', labelKey: 'panelCoverage', component: CoveragePanel, available: (graph) => graph.nodes.some((n) => n.kind === 'file' && n.pack === 'code') },
    { id: 'patterns', labelKey: 'panelPatterns', component: PatternsPanel, available: (graph) => graph.nodes.some((n) => n.kind === 'file' && n.pack === 'code') },
    { id: 'api', labelKey: 'panelApi', component: ApiPanel, available: (graph) => graph.nodes.some((n) => n.kind === 'file' && n.pack === 'code') },
    { id: 'resolve', labelKey: 'panelResolve', component: ResolvePanel, available: (graph) => graph.findings.length > 0 },
    { id: 'simulate', labelKey: 'panelSimulate', component: SimulatePanel, available: (_graph, env) => env.hasLines },
];
