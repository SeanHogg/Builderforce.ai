/**
 * Where the heatmap sends a reader (PRD 33 §4.1): the panel levels it opens.
 * One place, so the element table, the insights and any later caller build
 * the same `issues` filter and the same `route` address.
 */

import { filterToQuery, type ReplayFilterClause } from '@builderforce/interaction-contract';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';

/**
 * The `issues` kind narrowed to visits on the route (and, given one, that
 * clicked the element). The level id IS the filter's query string
 * (`filterToQuery`), which the `issues` kind reads back with `filterFromQuery`.
 */
export function issuesOnRoute(route: string, selector: string | null = null): InsightPanelLevel {
  const all: ReplayFilterClause[] = [{ field: 'visitedPath', op: 'eq', value: route }];
  if (selector) all.push({ field: 'clickedSelector', op: 'eq', value: selector });
  return { kind: 'issues', id: filterToQuery({ all }).toString() };
}

/** The `route` kind's heat tab for a route. */
export function routeHeatLevel(route: string): InsightPanelLevel {
  return { kind: 'route', id: route, tab: 'heat' };
}
