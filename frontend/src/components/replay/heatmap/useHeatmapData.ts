/**
 * The reads one heatmap needs, through `replayApi` only: the layer's grid for
 * the release (and for the compare release when a compare mode is on), the
 * ranked elements (with Δ against the compare release), the releases and —
 * when the route picker shows — the busiest routes.
 */

import type {
  ReplayDeviceClass,
  ReplayElementRowDto,
  ReplayHeatGridDto,
  ReplayHeatKind,
  ReplayReleaseDto,
  ReplayRouteStatDto,
} from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useAdminData } from '@/components/admin/adminShared';

export interface HeatmapSelection {
  route: string;
  release: string | null;
  compare: string | null;
  device: ReplayDeviceClass | null;
  kind: ReplayHeatKind;
  days?: number;
}

export interface HeatmapData {
  grid: ReplayHeatGridDto | null;
  compareGrid: ReplayHeatGridDto | null;
  elements: ReplayElementRowDto[];
  releases: ReplayReleaseDto[];
  routes: ReplayRouteStatDto[];
  loading: boolean;
  error: string;
}

export function useHeatmapData(
  siteId: string,
  selection: HeatmapSelection,
  options: { withCompareGrid: boolean; withRoutes: boolean },
): HeatmapData {
  const { route, release, compare, device, kind, days } = selection;
  const compareGridFor = options.withCompareGrid ? compare : null;

  const grid = useAdminData<ReplayHeatGridDto>(
    () => replayApi.heatGrid(siteId, { route, release, device, kind, days }),
    [siteId, route, release, device, kind, days],
  );
  const compareGrid = useAdminData<ReplayHeatGridDto | null>(
    () => (compareGridFor ? replayApi.heatGrid(siteId, { route, release: compareGridFor, device, kind, days }) : Promise.resolve(null)),
    [siteId, route, compareGridFor, device, kind, days],
  );
  const elements = useAdminData<ReplayElementRowDto[]>(
    () => replayApi.heatElements(siteId, { route, release, compare, device, days }),
    [siteId, route, release, compare, device, days],
  );
  const releases = useAdminData<ReplayReleaseDto[]>(() => replayApi.listReleases(siteId), [siteId]);
  const withRoutes = options.withRoutes;
  const routes = useAdminData<ReplayRouteStatDto[]>(
    () => (withRoutes ? replayApi.heatRoutes(siteId, { days }) : Promise.resolve([])),
    [siteId, days, withRoutes],
  );

  return {
    grid: grid.data,
    compareGrid: compareGridFor ? compareGrid.data : null,
    elements: elements.data ?? [],
    releases: releases.data ?? [],
    routes: routes.data ?? [],
    loading: grid.loading || elements.loading,
    error: grid.error || elements.error || compareGrid.error,
  };
}
