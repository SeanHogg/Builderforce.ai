import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import {
  destinationForRoute,
  destinationPitchKey,
  detailRoutes,
  getRouteMarketing,
  indexableTeaserRoutes,
  isNoindexTeaserRoute,
  marketedRoutes,
  noindexTeaserRoutes,
  teaserDestinationIds,
} from './routeMarketing';

/** The `routeMarketing` namespace as a nested object, for key lookups. */
const NS = en.routeMarketing as unknown as Record<string, Record<string, { description?: string }>>;

function pitchFor(groupId: string): string | undefined {
  return NS.destination?.[groupId]?.description;
}

describe('the marketed registry', () => {
  it('keys every surface by PATH, never by link', () => {
    // A surface `href` may carry a query or point off-site; either one registers
    // a key no pathname can ever equal.
    for (const route of marketedRoutes()) {
      expect(route.startsWith('/')).toBe(true);
      expect(route).not.toContain('?');
    }
  });

  it('gives a destination its OWN row when several surfaces link into it', () => {
    // Four Orchestrate surfaces link into /projects. Last-wins had the route
    // titled "Workforce Kanban & Templates"; first-wins keeps the destination.
    expect(getRouteMarketing('/projects')?.title).toBe('Projects / Tasks');
    expect(getRouteMarketing('/workforce')?.title).toBe('Workforce Mesh');
  });

  it('backs every DETAILS overlay with a base row', () => {
    // Without a base, the overlay's highlights and FAQ landed under the generic
    // hero — a Brain Storm page headed "This is part of Builderforce.ai".
    const orphans = detailRoutes().filter((route) => !marketedRoutes().includes(route));
    expect(orphans).toEqual([]);
  });

  it('merges the overlay onto its base', () => {
    const brainstorm = getRouteMarketing('/brainstorm');
    expect(brainstorm?.title).toBe('Brain Storm');
    expect(brainstorm?.faq?.length).toBeGreaterThan(0);
  });

  it('resolves a child route to its parent surface', () => {
    expect(getRouteMarketing('/settings/members')?.title).toBe(getRouteMarketing('/settings')?.title);
  });
});

describe('the destination tier', () => {
  it('names a route no surface markets', () => {
    // The route from the report: /inbox had no registry entry and so met the
    // generic gate. It is a nav row, so it has a name, an icon and a pitch.
    expect(getRouteMarketing('/inbox')).toBeNull();
    expect(destinationForRoute('/inbox')?.id).toBe('inbox');
  });

  it('covers the seats, reliability and the restricted account types', () => {
    expect(destinationForRoute('/seat/finance')?.id).toBe('finance');
    expect(destinationForRoute('/incidents')?.id).toBe('reliability');
    expect(destinationForRoute('/freelancer/profile')?.id).toBe('freelancer-profile');
    expect(destinationForRoute('/sales')?.id).toBe('sales');
  });

  it('has a localized pitch for every destination', () => {
    // The ratchet: a nav row added without a pitch would render the generic page
    // under a real destination's name. messages.test.ts extends this to the
    // other four catalogs.
    const missing = teaserDestinationIds().filter((id) => !pitchFor(id));
    expect(missing).toEqual([]);
  });

  it('keys the pitch the way the component asks for it', () => {
    expect(destinationPitchKey('inbox')).toBe('destination.inbox.description');
  });
});

describe('indexing', () => {
  it('indexes the destinations a visitor could plausibly search for', () => {
    const routes = indexableTeaserRoutes();
    for (const route of ['/inbox', '/insights', '/incidents', '/seat/finance', '/growth']) {
      expect(routes).toContain(route);
    }
  });

  it('keeps operator tooling and personal consoles out of the index', () => {
    const routes = indexableTeaserRoutes();
    for (const route of ['/admin', '/admin/sales', '/tenants', '/settings', '/agent-worker', '/sales', '/freelancer/profile']) {
      expect(routes).not.toContain(route);
      expect(isNoindexTeaserRoute(route)).toBe(true);
    }
  });

  it('does not index the generic tier', () => {
    // Its body is identical at every route that reaches it, so indexing it files
    // the same page under dozens of URLs.
    expect(destinationForRoute('/compile')).toBeUndefined();
    expect(getRouteMarketing('/compile')).toBeNull();
    expect(isNoindexTeaserRoute('/compile')).toBe(true);
  });

  it('indexes a marketed surface and a named destination', () => {
    expect(isNoindexTeaserRoute('/projects')).toBe(false);
    expect(isNoindexTeaserRoute('/inbox')).toBe(false);
  });

  it('lists no route twice', () => {
    const routes = indexableTeaserRoutes();
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('agrees with itself about what is excluded', () => {
    // The robots file, the sitemap and the page's own meta tag all read these
    // two functions, so a route in both lists would be invited and refused at
    // the same time — which is what the static robots.txt had been doing.
    const indexable = new Set(indexableTeaserRoutes());
    for (const route of noindexTeaserRoutes()) {
      expect(indexable.has(route)).toBe(false);
      expect(isNoindexTeaserRoute(route)).toBe(true);
    }
  });
});
