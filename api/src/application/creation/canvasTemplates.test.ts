/**
 * Canvas templates over `catalog_items` (kind 'canvas_template', migration 1263):
 * the wire shape `/api/creation-sessions/templates` has always returned, and the
 * audience rule — 'tenant' is everyone in the segment, 'private' is its author.
 */
import { describe, expect, it } from 'vitest';
import type { StoredTemplate } from '../templates/templateKinds';
import { canvasTemplateView, canvasTemplateVisibleTo } from './canvasTemplates';

const SEGMENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function stored(over: Partial<StoredTemplate>): StoredTemplate {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    tenantId: 3,
    segmentId: SEGMENT,
    kind: 'canvas_template',
    slug: 'canvas-11111111-2222-4333-8444-555555555555',
    name: 'Launch plan',
    summary: 'Everything for a launch',
    body: { graph: { objects: [], connections: [] }, updatedBy: 'u1', marketplaceListingId: 'L-1' },
    category: 'Custom',
    tags: null,
    version: '1.0.0',
    visibility: 'private',
    priceCents: null,
    currency: null,
    publisherRef: null,
    installCount: 0,
    createdBy: 'u1',
    publishedAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-02T00:00:00.000Z',
    ...over,
  };
}

describe('canvasTemplateView', () => {
  it('is the pre-1263 row shape the frontend client reads', () => {
    expect(canvasTemplateView(stored({}))).toEqual({
      id: '11111111-2222-4333-8444-555555555555',
      name: 'Launch plan',
      description: 'Everything for a launch',
      category: 'Custom',
      visibility: 'private',
      graph: { objects: [], connections: [] },
      createdBy: 'u1',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });
  });

  it('defaults a missing category and graph, and never reports public', () => {
    const view = canvasTemplateView(stored({ category: null, body: null, visibility: 'public' }));
    expect(view.category).toBe('Custom');
    expect(view.graph).toBeNull();
    expect(view.visibility).toBe('private');
  });
});

describe('canvasTemplateVisibleTo', () => {
  it('a private template is its author\'s only', () => {
    expect(canvasTemplateVisibleTo(stored({}), SEGMENT, 'u1')).toBe(true);
    expect(canvasTemplateVisibleTo(stored({}), SEGMENT, 'u2')).toBe(false);
  });

  it('a tenant template is everyone\'s in the segment', () => {
    expect(canvasTemplateVisibleTo(stored({ visibility: 'tenant' }), SEGMENT, 'u2')).toBe(true);
  });

  it('never crosses segments', () => {
    expect(canvasTemplateVisibleTo(stored({ visibility: 'tenant' }), 'ffffffff-0000-4000-8000-000000000000', 'u1')).toBe(false);
  });
});
