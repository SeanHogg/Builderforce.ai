/**
 * What Synapse's window imports from the console bundle — a narrow, framework-free API
 * over the shared React surfaces, so the window (plain modules) never touches React:
 *
 *  - `mountEvermindConsole` renders the SAME `<EvermindConsole>` the VS Code extension
 *    shows — Teach, Test, Check, Maintain — on a workspace Evermind, wired through the
 *    shared REST adapter to the `request` the window supplies.
 *  - `loadEvermindBuilds` / `preferredEvermindBuild` list and pick the workspace's
 *    Evermind models by the extension's rules.
 *  - `cloudBrain` reads a model's payload into brain regions with the web Knowledge Map's
 *    own derivation, so the desktop brain lights what the web brain lights.
 */
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_EVERMIND_LABELS,
  EvermindConsole,
  createEvermindRestAdapter,
  evermindLabelsFromBundle,
  type EvermindConsoleData,
  type EvermindHostPowers,
  type EvermindRequest,
} from '@seanhogg/builderforce-brain-ui';
import { evermindRegionSignals, recentForRegion } from '@/lib/evermindRegions';
import bundles from 'virtual:evermind-labels';

export { isManagerRole, loadEvermindBuilds, preferredEvermindBuild } from '@seanhogg/builderforce-brain-ui';

export interface ConsoleMount {
  /** Host-owned access: the authenticated call, plus any host powers. */
  host: EvermindHostPowers & { request: EvermindRequest };
  /** The Evermind's storage project id. */
  projectId: number;
  projectName?: string;
  canManage: boolean;
  /** One of Synapse's locales; anything else reads English. */
  locale: string;
  /** Every payload the console reads, so the window's brain moves with it. */
  onData?: (data: EvermindConsoleData) => void;
}

/** Render the console into `el`. `refresh()` reloads it in place; `unmount()` removes it. */
export function mountEvermindConsole(el: HTMLElement, m: ConsoleMount): { refresh(): void; unmount(): void } {
  const base = createEvermindRestAdapter({ ...m.host, projectId: m.projectId });
  const adapter = {
    ...base,
    loadData: async () => {
      const data = await base.loadData();
      m.onData?.(data);
      return data;
    },
  };
  const labels = { ...DEFAULT_EVERMIND_LABELS, ...evermindLabelsFromBundle(bundles[m.locale] ?? bundles.en ?? {}) };
  const root = createRoot(el);
  let signal = 0;
  const render = () =>
    root.render(
      <EvermindConsole
        adapter={adapter}
        canManage={m.canManage}
        projectName={m.projectName}
        labels={labels}
        host="synapse"
        // The page draws the region-filterable learned list beside the brain.
        showRecent={false}
        refreshSignal={signal}
        refreshMs={20_000}
      />,
    );
  render();
  return {
    refresh: () => {
      signal += 1;
      render();
    },
    unmount: () => root.unmount(),
  };
}

type Signal = { charge: number; count: number; active: boolean };
type BrainEntry = { id: number; kind: 'text' | 'delta'; version: number; at: number; prompt?: string; text?: string; fitted?: boolean; distilled?: boolean; teacherModel?: string };

/** A model's payload as brain regions: each region's live signal, and the learned
 *  entries the two memory regions hold (hippocampus = taught, neocortex = fitted). */
export function cloudBrain(data: EvermindConsoleData | null): { signals: Record<string, Signal>; neocortex: BrainEntry[]; hippocampus: BrainEntry[] } {
  const payload = data as Parameters<typeof evermindRegionSignals>[0];
  const recent = payload?.recent ?? [];
  return {
    signals: evermindRegionSignals(payload),
    neocortex: recentForRegion(recent, 'neocortex'),
    hippocampus: recentForRegion(recent, 'hippocampus'),
  };
}
