/**
 * `retiredRoute()` — the ONE way a moved-or-retired route forwards to its new home.
 *
 * Ten routes had each hand-rolled the same page: `'use client'`, `useRouter()`,
 * a `useEffect` that calls `router.replace(...)`, and `return null`. That shape
 * is a redirect implemented as an application, and it costs what an application
 * costs — the visitor downloads and hydrates the whole client runtime (root
 * layout providers included) only to be sent somewhere else a frame later, and
 * a crawler sees a 200 with an empty body instead of a redirect.
 *
 * A retired route is a SERVER concern: Next's `redirect()` answers the request
 * with a real HTTP redirect, so the route bundle is never fetched at all.
 *
 * Use it for routes whose destination is a pure function of the URL. A route
 * that must ASK something before it can forward (open a canvas session, resolve
 * a project by public id) is not this — it needs a client leaf, and it should
 * keep one; see `app/projects/[id]/page.tsx`.
 *
 * ```tsx
 * // app/hires/page.tsx
 * export default retiredRoute('/workforce?tab=talent');
 *
 * // carrying part of the incoming query across
 * export default retiredRoute((search) =>
 *   `/projects?tab=tasks${search.project ? `&project=${search.project}` : ''}`);
 * ```
 *
 * A destination FUNCTION reads the query string, which makes the route dynamic —
 * declare `export const runtime = 'edge'` beside it (check:edge-runtime enforces
 * this). A constant destination needs no runtime export: it prerenders.
 */
import { redirect, type RedirectType } from 'next/navigation';

/** Next's decoded `searchParams`, flattened to first-value-wins. */
export type RetiredRouteSearch = Record<string, string | undefined>;

type Destination = string | ((search: RetiredRouteSearch) => string);

type RouteProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** `?a=1&a=2` is one question asked twice; the first answer is the one meant. */
function firstValues(raw: Record<string, string | string[] | undefined>): RetiredRouteSearch {
  const out: RetiredRouteSearch = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

export function retiredRoute(destination: Destination, type?: RedirectType) {
  return async function RetiredRoutePage({ searchParams }: RouteProps) {
    const to = typeof destination === 'function'
      ? destination(firstValues((await searchParams) ?? {}))
      : destination;
    redirect(to, type);
  };
}
