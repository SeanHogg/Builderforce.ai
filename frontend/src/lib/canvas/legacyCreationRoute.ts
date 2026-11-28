import { projectFromSearch } from '@/lib/projectScopeResolution';

export const LEGACY_CREATION_ROUTE_PARAM = '_fromCreateRoute';

const LEGACY_CREATION_ROUTES = ['/brainstorm', '/workflows', '/workflows/builder', '/ide'] as const;
export type LegacyCreationRoute = typeof LEGACY_CREATION_ROUTES[number];

export function isLegacyCreationRoute(value: string | null): value is LegacyCreationRoute {
  return LEGACY_CREATION_ROUTES.some((route) => route === value);
}

/** Carry only the route family to Create, never an identifier from the old URL. */
export function markLegacyCreationRoute(search: URLSearchParams, source: LegacyCreationRoute): void {
  search.set(LEGACY_CREATION_ROUTE_PARAM, source);
}

export function legacyCreationHref(href: string, source: LegacyCreationRoute): string {
  const url = new URL(href, 'https://builderforce.invalid');
  markLegacyCreationRoute(url.searchParams, source);
  return url.pathname + url.search + url.hash;
}

export function legacyWorkflowLibraryHref(
  source: '/workflows' | '/workflows/builder',
  search: Pick<URLSearchParams, 'get'>,
): string {
  const params = new URLSearchParams({ filter: 'workflow' });
  const projectId = projectFromSearch(search);
  if (projectId !== null) params.set('project', String(projectId));
  return legacyCreationHref(`/create?${params}`, source);
}
