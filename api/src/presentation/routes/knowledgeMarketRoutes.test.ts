/**
 * Public knowledge listings: ONE handler. The public `/api/knowledge-market/listings`
 * is canonical; the authed `/api/knowledge/listings` is the same handler, stamped
 * deprecated with the public successor.
 */
import { describe, expect, it, vi } from 'vitest';

const listings = [{ id: 'l1', title: 'Runbook' }];
const browse = vi.hoisted(() => vi.fn());

vi.mock('../middleware/authMiddleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/authMiddleware')>()),
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', 3); await next(); },
}));
vi.mock('../../application/knowledge/knowledgeMarket', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/knowledge/knowledgeMarket')>()),
  browsePublicListings: browse,
}));

const { createKnowledgeMarketRoutes } = await import('./knowledgeMarketRoutes');
const { createKnowledgeRoutes } = await import('./knowledgeRoutes');

const db = {} as never;

describe('knowledge listings', () => {
  it('serves the public canonical path without deprecation headers', async () => {
    browse.mockResolvedValue(listings);
    const res = await createKnowledgeMarketRoutes(db).request('/listings', {}, {});
    expect(await res.json()).toEqual({ listings });
    expect(res.headers.get('Deprecation')).toBeNull();
  });

  it('serves the authed legacy path from the same handler, naming the public successor', async () => {
    browse.mockResolvedValue(listings);
    const res = await createKnowledgeRoutes(db).request('/listings', {}, {});
    expect(await res.json()).toEqual({ listings });
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toBe('</api/knowledge-market/listings>; rel="successor-version"');
  });
});
