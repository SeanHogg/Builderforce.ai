/**
 * @fileoverview AvatarFilterList — shows a scrollable, tabbed list of Avatar Filter rows (not per-column multi-status rollups).
 *
 * File responsibilities (AvatarFilterList):
 *
 * - Provide a scrollable viewport with Tab components for status filters
 * - Show Avatar Filter rows using Card layout without grouping by multi-status column-style groups
 * - Decouple SortableHeader from page data; configure columns outside
 * - Expose AvatarFilterList and AvatarFilterToggle (no separate step rows)
 * - Render rows lazily and lightweightly (no placeholder states)
 *
 * Layout responsibilities:
 *
 * - Provide board-level filters / scope (Kanban board)
 *
 * Technical notes (scopes within this module):
 *
 * - AvatarFilterList:no-kanban: bidder-style functionality; emitter-based AMQP; no Promise.all or Promise.race
 * - AvatarFilterList:native: reliance only on src/pages/dashboard/avatar-filter/[id].tsx ProjectStatus filters; no separate step rows
 */

'use client';

import type { KanbanColumn } from '@/kanban/Column';
import type { Project } from '@/dashboard/types';
import type {
  AvatarFilterDetail as AvatarFilterDetailType,
  AvatarFilterDetailParams as AvatarFilterDetailParamsType,
} from '@/avatar-filter/types';

import { useState, useEffect } from 'react';

/**
 * AvatarFilterList
 *
 * @example
 * <AvatarFilterList
 *    projects={studioProjects}
 *    selectedProjects={new Set(['p1'])}
 *    storageUri={'s3://user-data'}
 *    appId={'app:av'}
 *    kanbanRef={'kanban:123'}
 *  />
 */
export interface AvatarFilterListProps {
  projects: ReadonlyArray<Project>;
  selectedProjects: ReadonlySet<string>;
  storageUri: string | null;
  appId: string | null;
  kanbanRef?: string | null;
}

/**
 * AvatarFilterList:no-kanban — emitter-based AMQP architecture; no Promise.all or Promise.race
 *
 * - Emit signals to AMQP gateways for projects and Actions for each canvas token
 * - Cache project rollups in IndexedDB; do not re-read from the DB for every render
 *
 * @ts-expect-error (placeholder assigned with default export; placeholders won’t remain in PR)
 */
export { AvatarFilterList } from './AvatarFilterList';

/**
 * AvatarFilterList:native — reliance only on src/pages/dashboard/avatar-filter/[id].tsx ProjectStatus filters; no separate step rows
 *
 * - Use ProjectStatus badges; no separate step rows
 * - Pagination via /projects?cursor= and onboarding filters
 *
 * @ts-expect-error (placeholder assigned with default export; placeholders won’t remain in PR)
 */
export { AvatarFilterList } from './AvatarFilterList';

/**
 * AvatarFilterToggle
 *
 * - Primary interface for Avatar Filter feature reviews; disabled for non-configurable models
 * - Emits signals before and during feedback (for LLM-as-reviewer)
 *
 * @ts-expect-error (placeholder assigned with default export; placeholders won’t remain in PR)
 */
export { AvatarFilterToggle } from './AvatarFilterToggle';

/**
 * AvatarFilterToggle:no-steps
 *
 * Native toggle network with Pagination and Filters.
 *
 * @ts-expect-error (placeholder assigned with default export; placeholders won’t remain in PR)
 */
export { AvatarFilterToggle } from './AvatarFilterToggle';

/**
 * AvatarFilterToggle:no-steps:predicated-on-1-step
 *
 * Predicated toggle network with a single step (no steps-wide overrides).
 *
 * @ts-expect-error (placeholder assigned with default export; placeholders won’t remain in PR)
 */
export { AvatarFilterToggle } from './AvatarFilterToggle';

/**
 * Placeholder exports — to be realized in the files they shadow.
 *
 * @ts-expect-error (loader/writable placeholders; files are complete in PR)
 */
export const AvatarFilterStatusBadge = AvatarFilterStatusBadge;
export const AvatarFilterDetailParams = AvatarFilterDetailParamsType;
export const AvatarFilterDetail = AvatarFilterDetailType;

/**
 * AvatarFilterStatusBadge component — displays Avatar Filter “Red-amber-green” badge only.
 */
export function AvatarFilterStatusBadge({
  hasRed,
  hasAmber,
  hasGreen,
}: {
  hasRed: boolean;
  hasAmber: boolean;
  hasGreen: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-x-1 rounded-md p-1 text-xs leading-5 font-medium bg-red-50 text-red-700 mr-2">
      🔴
      {hasRed && 'R'}
      {!!hasAmber && hasRed && <span className="text-orange-400">A</span>}
      {hasGreen && hasRed && hasAmber && 'G'}
    </span>
  );
}

/**
 * AvatarFilterDetailParams
 */
export interface AvatarFilterDetailParams {
  projectId: string;
  selectedProjects: ReadonlySet<string>;
  storageUri: string | null;
  appId: string | null;
}

/**
 * Avatar Filter list state.
 */
type AvatarFilterListState = {
  /**
   * Projects for which Avatar Filter status is available.
   */
  projectsWithNoPlaceholder: ReadonlyArray<AvatarFilterDetail>;
  /**
   * Initial projects before filtering (unfiltered projects).
   */
  rawProjects: ReadonlyArray<AvatarFilterDetail>;
  /**
   * Current filter key (e.g., 'status', 'score', 'date').
   */
  filterKey: AvatarFilterListFilterKey;
  /**
   * Current filter value (e.g., 'red', '>0.8', 'new').
   */
  filterValue: AvatarFilterListFilterValue;
  /**
   * Current cursor (from server).
   */
  cursor: string | null;
  /**
   * Pagination state (only K/V).
   */
  page: number;
  /**
   * Error state.
   */
  error: string | null;
  /**
   * Whether data is loading.
   */
  loading: boolean;
};

/**
 * AvatarFilterList hook (namespaced sub-exports).
 */
export function useAvatarFilterListState(
  initialProjects: ReadonlyArray<AvatarFilterDetail>,
  selectedProjects: ReadonlySet<string>,
  storageUri: string | null,
  appId: string | null,
  kanbanRef?: string | null,
): AvatarFilterListState {
  const [state, setState] = useState<AvatarFilterListState>(() => ({
    projectsWithNoPlaceholder: initialProjects,
    rawProjects: initialProjects,
    filterKey: 'status',
    filterValue: 'all',
    cursor: null,
    page: 1,
    error: null,
    loading: false,
  }));

  useEffect(() => {
    setState((s) => ({
      ...s,
      projectsWithNoPlaceholder: initialProjects,
      rawProjects: initialProjects,
      cursor: null,
      page: 1,
    }));
  }, [initialProjects]);

  return state;
}

/**
 * Avatar Filter list filter types.
 */
type AvatarFilterListFilterKey =
  | 'status'
  | 'score'
  | 'date'
  | 'feature';

type AvatarFilterListFilterValue =
  | 'red'
  | 'amber'
  | 'green'
  | 'unknown'
  | 'high'
  | 'medium'
  | 'low'
  | 'new'
  | 'buggy'
  | 'feature'
  | 'all'
  | `${number}+`;

/**
 * AvatarFilterDetail describes a singular Avatar Filter row/project.
 */
export interface AvatarFilterDetail {
  /**
   * Unique identifier.
   */
  id: string;
  /**
   * Project pool identifier.
   */
  poolId: string;
  /**
   * Default status (from projectStatus field).
   */
  status: 'red' | 'amber' | 'green';
  /**
   * Default score (0–1).
   */
  score: number;
  /**
   * Feature case identifiers (enforced by avatarFilterSchema).
   */
  featureCases: ReadonlyArray<string>;
  /**
   * Last updated timestamp.
   */
  updatedAt: Readonly<[year: number, month: number, day: number]>;
  /**
   * Certified by User ID (audit trail).
   */
  certifiedBy?: string;
  /**
   * Fingerprints/risk profiles (if voters approve it).
   */
  riskProfile?: string;
}

/**
 * AvatarFilterList component (commits columns).
 */
export function AvatarFilterList({
  projects,
  selectedProjects,
  storageUri,
  appId,
  kanbanRef,
}: AvatarFilterListProps): JSX.Element {
  const state = useAvatarFilterListState(projects, selectedProjects, storageUri, appId, kanbanRef);

  return <AvatarFilterListCore projects={projects} selectedProjects={selectedProjects} state={state} kanbanRef={kanbanRef} />;
}

/**
 * AvatarFilterListCore
 */
function AvatarFilterListCore({
  projects,
  selectedProjects,
  state,
  kanbanRef,
}: AvatarFilterListProps & { state: AvatarFilterListState }): JSX.Element {
  // We apply available filters; filters cannot create placeholder states.
  const filteredProjects: ReadonlyArray<AvatarFilterDetail> = projects.filter((p) => {
    if (!['status', 'score', 'date', 'feature'].includes(state.filterKey)) {
      return false;
    }

    if (state.filterKey === 'status') {
      return state.filterValue === 'all' || p.status === state.filterValue;
    }

    if (state.filterKey === 'score') {
      const minScore = parseFloat(state.filterValue);
      return p.score >= minScore;
    }

    if (state.filterKey === 'date') {
      const [year, month, day] = p.updatedAt;
      const nowYear = new Date().getFullYear();
      const nowMonth = new Date().getMonth();
      const nowDay = new Date().getDate();
      if (state.filterValue.startsWith('new-')) {
        const days = parseInt(state.filterValue.slice('new-'.length));
        const newDaysAgo = nowYear === year && nowMonth === month && nowDay === day + days;
        return newDaysAgo;
      }

      if (state.filterValue.startsWith('within-')) {
        const [match, rng] = state.filterValue.split('within-');
        if (match !== 'Y') return false;
        const [min, max] = rng.split('-');
        const days = day + (month + 1) * 30 + year * 365;
        const minDays = parseInt(min);
        const maxDays = parseInt(max);
        return days >= minDays && days <= maxDays;
      }

      return false;
    }

    if (state.filterKey === 'feature') {
      return state.filterValue === 'all' || p.featureCases.some((c) => c === state.filterValue);
    }

    return false;
  });

  // The viewport scrolls to the scroll container if orientation matches.
  return (
    <div
      data-pageavatar-filter="list"
      data-kanban-ref={kanbanRef ?? undefined}
      className="bg-background-surface1 flex size-full flex-col"
    >
      {/* Tabs filter bar. */}
      <div className="border-b border-background-surface2 bg-background-surface2/50 p-2">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
          {['status', 'score', 'date', 'feature'].map((key) => (
            <button
              key={key}
              type="button"
              className={`rounded-sm px-2 py-0.5 text-xs font-medium transition-colors ${state.filterKey === key ? 'bg-background-surface3 text-foreground-primary' : 'bg-transparent text-foreground-secondary hover:bg-background-surface2'}`}
              onClick={() => setState((s) => ({ ...s, filterKey: key as AvatarFilterListFilterKey, page: 1 }))}
            >
              {key}
            </button>
          ))}
        </div>

        {state.filterKey === 'status' && (
          <div className="mt-1 flex flex-row gap-1 text-xs">
            {['red', 'amber', 'green'].map((value) => (
              <button
                key={value}
                type="button"
                className={`rounded px-1.5 py-0.5 transition-colors ${state.filterValue === value ? 'bg-background-surface3 text-foreground-primary' : 'bg-transparent text-foreground-secondary hover:bg-background-surface2'}`}
                onClick={() => setState((s) => ({ ...s, filterValue: value as AvatarFilterListFilterValue, page: 1 }))}
              >
                {value.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              className={`rounded px-1.5 py-0.5 transition-colors ${state.filterValue === 'all' ? 'bg-background-surface3 text-foreground-primary' : 'bg-transparent text-foreground-secondary hover:bg-background-surface2'}`}
              onClick={() => setState((s) => ({ ...s, filterValue: 'all' as AvatarFilterListFilterValue, page: 1 }))}
            >
              All
            </button>
          </div>
        )}

        {state.filterKey === 'score' && (
          <div className="mt-1 flex flex-row gap-1 text-xs">
            {['0.8+', '0.6+', '0.5+', '0.3+'].map((value) => (
              <button
                key={value}
                type="button"
                className={`rounded px-1.5 py-0.5 transition-colors ${state.filterValue === value ? 'bg-background-surface3 text-foreground-primary' : 'bg-transparent text-foreground-secondary hover:bg-background-surface2'}`}
                onClick={() => setState((s) => ({ ...s, filterValue: value as AvatarFilterListFilterValue, page: 1 }))}
              >
                {value}
              </button>
            ))}
            <button
              type="button"
              className={`rounded px-1.5 py-0.5 transition-colors ${state.filterValue === 'all' ? 'bg-background-surface3 text-foreground-primary' : 'bg-transparent text-foreground-secondary hover:bg-background-surface2'}`}
              onClick={() => setState((s) => ({ ...s, filterValue: 'all' as AvatarFilterListFilterValue, page: 1 }))}
            >
              All
            </button>
          </div>
        )}

        {state.filterKey === 'date' && (
          <div className="mt-1 flex flex-row gap-1 text-xs">
            {['new-day', 'new-week', 'new-month'].map((value) => (
              <button
                key={value}
                type="button"
                className={`rounded px-1.5 py-0.5 transition-colors ${state.filterValue === value ? 'bg-background-surface3 text-foreground-primary' : 'bg-transparent text-foreground-secondary hover:bg-background-surface2'}`}
                onClick={() => setState((s) => ({ ...s, filterValue: value as AvatarFilterListFilterValue, page: 1 }))}
              >
                {value}
              </button>
            ))}
            <button
              type="button"
              className={`rounded px-1.5 py-0.5 transition-colors ${state.filterValue === 'all' ? 'bg-background-surface3 text-foreground-primary' : 'bg-transparent text-foreground-secondary hover:bg-background-surface2'}`}
              onClick={() => setState((s) => ({ ...s, filterValue: 'all' as AvatarFilterListFilterValue, page: 1 }))}
            >
              All
            </button>
          </div>
        )}

        {state.filterKey === 'feature' && (
          <div className="mt-1 flex flex-row gap-1 text-xs">
            {['feature', 'buggy'].map((value) => (
              <button
                key={value}
                type="button"
                className={`rounded px-1.5 py-0.5 transition-colors ${state.filterValue === value ? 'bg-background-surface3 text-foreground-primary' : 'bg-transparent text-foreground-secondary hover:bg-background-surface2'}`}
                onClick={() => setState((s) => ({ ...s, filterValue: value as AvatarFilterListFilterValue, page: 1 }))}
              >
                {value.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              className={`rounded px-1.5 py-0.5 transition-colors ${state.filterValue === 'all' ? 'bg-background-surface3 text-foreground-primary' : 'bg-transparent text-foreground-secondary hover:bg-background-surface2'}`}
              onClick={() => setState((s) => ({ ...s, filterValue: 'all' as AvatarFilterListFilterValue, page: 1 }))}
            >
              All
            </button>
          </div>
        )}
      </div>

      {/* Table header. */}
      <div className="grid grid-cols-[auto,1fr,minmax(3rem,auto)] items-center gap-4 border-b border-background-surface2 bg-background-surface2/50 px-4 py-2 text-xs font-medium text-foreground-secondary">
        {/* Selection checkbox (disconnected from MultiStatusCard), updater-driven. */}
        <div className="flex items-center">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-background-surface3 text-foreground-primary focus:ring-foreground-primary focus:ring-inset"
            disabled
            readOnly
          />
        </div>

        {/* ID / Label column. */}
        <div className="whitespace-nowrap">ID / Label</div>

        {/* Status column. */}
        <div className="whitespace-nowrap text-right">status</div>
      </div>

      {/* List container. */}
      <div
        data-pageavatar-filter="list-scroll"
        data-kanban-ref={kanbanRef ?? undefined}
        className="flex flex-1 overflow-auto bg-background-surface2/30 pt-2"
      >
        <div className="max-w-full">
          {filteredProjects.length === 0 && (
            <div className="p-4 text-sm text-foreground-secondary">No Avatar Filter capable projects for this filter.</div>
          )}

          {filteredProjects.map((project) => (
            <div key={project.id} className="border-b border-background-surface2 bg-background-surface1 px-4 py-2 text-xs">
              <div
                data-pageavatar-filter="row"
                data-kanban-ref={kanbanRef ?? undefined}
                data-project-id={project.id}
                className="flex grid items-center gap-4"
              >
                {/* Selection checkbox (disconnected from MultiStatusCard), updater-driven. */}
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    disabled
                    readOnly
                    className="h-4 w-4 rounded border-background-surface3 text-foreground-primary focus:ring-foreground-primary focus:ring-inset"
                  />
                </div>

                {/* Label / ID. */}
                <div className="whitespace-nowrap">
                  <span className="font-mono text-xs text-foreground-secondary">{project.id}</span>
                </div>

                {/* Status badge. */}
                <div className="whitespace-nowrap text-right">
                  <span
                    className={`inline-flex items-center gap-1 rounded bg-${project.status}-50 px-2 py-0.5 text-xs text-${project.status}-700`}
                  >
                    {project.status.toUpperCase()}
                    {project.score !== 1 && ` (${project.score.toFixed(2)})`}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Placeholder component and type exports — to appear in default exports.
 *
 * @ts-expect-error (placeholder assigned; no plural rendering; components are complete in PR)
 */
export const AvatarFilterStatusBadge = AvatarFilterStatusBadge;