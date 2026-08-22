'use client';

import type { ComponentDef, ComponentMount } from '@/lib/components/types';
import type { Domain } from '@/lib/kernel/kernelApi';
import { ComponentScopeProvider, useComponentProjectId } from '@/lib/components/scope';
import { PmScopeProvider } from '@/lib/pm/scope';
import { TaskMgmtContent } from '@/components/TaskMgmtContent';
import { BrainPanel } from '@/components/brain/BrainPanel';
import { EmbedPrdSurface } from '@/components/embed/EmbedPrdSurface';
import { Soc2Content } from '@/components/governance/Soc2Content';
import { TrackerSurface } from '@/components/governance/TrackerSurface';
import { TRACKER_CONFIGS } from '@/components/governance/trackerConfigs';
import { PokerSurface } from '@/components/agile/PokerSurface';
import { RetroSurface } from '@/components/agile/RetroSurface';
import { PmVisualizersContent } from '@/components/pm/PmVisualizersContent';
import { DependencyGraph } from '@/components/pm/DependencyGraph';
import { RiceMatrix } from '@/components/pm/RiceMatrix';
import { RoiDashboard } from '@/components/pm/RoiDashboard';
import { WorkforceAgents } from '@/components/workforce/WorkforceAgents';

/**
 * THE FULL-SURFACE COMPONENTS — the ones an entrepreneur puts on a board or
 * inside their own published app.
 *
 * ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
 * `app/embed/[view]/page.tsx` resolved a view with a 13-branch `switch` over ~20
 * hand-written imports, plus a `default:` that guessed at `TRACKER_CONFIGS`. Its
 * own header conceded that only "kanban + backlog" were really wired, and
 * `feature-roi` had already fallen through that default and rendered NOTHING
 * until somebody noticed and added a branch for it. That is the failure mode a
 * `default:` case always has and an allowlist never does: the switch grows a
 * branch every time somebody adds a feature, and nobody re-reads it.
 *
 * So the surfaces are declared here as registry DATA. Adding one is an entry,
 * and a key with no entry is absent rather than silently null.
 *
 * ── WHY THE WRAPPERS ARE THE POINT, NOT BOILERPLATE ──────────────────────────
 * Each wrapper below exists to make its surface SELF-CONTAINED: it owns the
 * provider its inner component needs and resolves its own project through
 * `useComponentProjectId`, instead of the mount passing one in. That is the
 * difference between a component that renders at `/embed/*` and a component that
 * can be dropped onto a board with zero edits — the surfaces were always capable
 * of it, and the props the old route threaded through were what pinned them to
 * one mount.
 *
 * ── WHY THE TRACKERS ARE GENERATED ───────────────────────────────────────────
 * Twenty-two of these are the SAME generic CRUD surface differing only by field
 * schema, and that schema is already data in `TRACKER_CONFIGS`. Writing them out
 * would be twenty-two copies of one line. They are generated from the config
 * registry, which also means a tracker cannot exist in one list and not the
 * other. Bespoke entries win, exactly as a `case` won over `default:` before.
 */

/** Where these render. Full surfaces, so never the dashboard's tile grid. */
const SURFACE_MOUNTS: readonly ComponentMount[] = ['app', 'canvas'];

/** i18n group keys — the three pillars a host enables, and what a board groups by. */
const PRODUCT = 'appProduct';
const AGILE = 'appAgile';
const GOVERNANCE = 'appGovernance';

// ─────────────────────────────────────────────────────────────────────────────
// Self-contained wrappers — each owns its own scope and providers
// ─────────────────────────────────────────────────────────────────────────────

/** Put the PM surfaces under the project scope they read, resolved for whatever
 *  mount they landed on. One helper, so eight surfaces cannot disagree. */
function WithPmScope({ children }: { children: React.ReactNode }) {
  const projectId = useComponentProjectId();
  return (
    <ComponentScopeProvider projectId={projectId}>
      <PmScopeProvider projectId={projectId}>{children}</PmScopeProvider>
    </ComponentScopeProvider>
  );
}

function IdeasSurface() { return <BrainPanel variant="page" />; }
function PrdSurface() { return <EmbedPrdSurface />; }
function TasksSurface() { return <TaskMgmtContent />; }
function RoadmapSurface() { return <WithPmScope><PmVisualizersContent /></WithPmScope>; }
function DependencyGraphSurface() { return <WithPmScope><DependencyGraph /></WithPmScope>; }
function RiceMatrixSurface() { return <WithPmScope><RiceMatrix /></WithPmScope>; }
function RoiDashboardSurface() { return <WithPmScope><RoiDashboard /></WithPmScope>; }
function Soc2Surface() { return <Soc2Content />; }
function PokerSessionSurface() { return <PokerSurface />; }
function RetroSurface_() { return <RetroSurface />; }
function WorkforceSurface() { return <WorkforceAgents />; }

// ─────────────────────────────────────────────────────────────────────────────
// The declarations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The bespoke surfaces, keyed by id.
 *
 * `roi-dashboard` and `feature-roi` are the same surface under two names — the
 * second is a `TRACKER_CONFIGS` key that the old switch had to special-case to
 * stop it rendering null. Declaring both here keeps that fix and makes the reason
 * visible rather than a comment inside a `case`.
 */
const BESPOKE: ReadonlyArray<{ id: string; group: string; domain?: Domain; Surface: ComponentDef['Surface'] }> = [
  { id: 'ideas',            group: PRODUCT,    domain: 'canvas',   Surface: IdeasSurface },
  { id: 'prd',              group: PRODUCT,    domain: 'delivery', Surface: PrdSurface },
  { id: 'backlog',          group: PRODUCT,    domain: 'delivery', Surface: TasksSurface },
  { id: 'roadmap',          group: PRODUCT,    domain: 'delivery', Surface: RoadmapSurface },
  { id: 'dependency-graph', group: PRODUCT,    domain: 'delivery', Surface: DependencyGraphSurface },
  { id: 'rice-matrix',      group: PRODUCT,    domain: 'delivery', Surface: RiceMatrixSurface },
  { id: 'roi-dashboard',    group: PRODUCT,    domain: 'delivery', Surface: RoiDashboardSurface },
  { id: 'feature-roi',      group: PRODUCT,    domain: 'delivery', Surface: RoiDashboardSurface },
  { id: 'kanban',           group: AGILE,      domain: 'delivery', Surface: TasksSurface },
  { id: 'poker',            group: AGILE,      domain: 'delivery', Surface: PokerSessionSurface },
  { id: 'retros',           group: AGILE,      domain: 'delivery', Surface: RetroSurface_ },
  { id: 'workforce',        group: AGILE,      domain: 'people',   Surface: WorkforceSurface },
  { id: 'soc2',             group: GOVERNANCE, domain: 'governance', Surface: Soc2Surface },
];

/** Which pillar a generated tracker belongs to. The governance trackers are the
 *  security posture; the rest are the product/agile ones `TRACKER_CONFIGS` also
 *  serves. Derived from the tracker's own API route so it cannot drift from the
 *  backend that answers it. */
function trackerGroup(apiBase: string): string {
  if (apiBase.startsWith('/api/governance/')) return GOVERNANCE;
  return apiBase.startsWith('/api/product/') ? PRODUCT : AGILE;
}

function trackerDomain(apiBase: string): Domain {
  return apiBase.startsWith('/api/governance/') ? 'governance' : 'delivery';
}

const BESPOKE_IDS = new Set(BESPOKE.map((b) => b.id));

/** One generic CRUD surface per tracker config, self-contained by construction:
 *  the config is captured in the closure, so the component takes no props. */
function trackerComponents(): ComponentDef[] {
  return Object.entries(TRACKER_CONFIGS)
    .filter(([id]) => !BESPOKE_IDS.has(id))
    .map(([id, config]) => {
      const Surface = () => <TrackerSurface {...config} />;
      Surface.displayName = `TrackerSurface(${id})`;
      return {
        id,
        group: trackerGroup(config.apiBase),
        titleKey: `app.${id}`,
        domain: trackerDomain(config.apiBase),
        Surface,
        mounts: SURFACE_MOUNTS,
      } satisfies ComponentDef;
    });
}

export const APP_SURFACE_COMPONENTS: ComponentDef[] = [
  ...BESPOKE.map(({ id, group, domain, Surface }) => ({
    id,
    group,
    titleKey: `app.${id}`,
    ...(domain ? { domain } : {}),
    Surface,
    mounts: SURFACE_MOUNTS,
  } satisfies ComponentDef)),
  ...trackerComponents(),
];
