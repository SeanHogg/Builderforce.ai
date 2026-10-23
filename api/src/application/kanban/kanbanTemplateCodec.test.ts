/**
 * KanbanTemplate ↔ catalog_items body — the layout migration 1263 writes in SQL
 * and the service reads in TS. The "migration-shaped" fixture below is exactly
 * what 1263's jsonb_build_object produces (nulls present, nothing stripped inside
 * a lane), so a drift between the SQL and this codec fails here, not in prod.
 */
import { describe, expect, it } from 'vitest';
import type { StoredTemplate } from '../templates/templateKinds';
import { kanbanBodyOf, kanbanPriceValues, kanbanTemplateFromStored, parseKanbanBody } from './kanbanTemplateCodec';
import type { TemplateLane } from './types';

function stored(over: Partial<StoredTemplate>): StoredTemplate {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    tenantId: 9,
    segmentId: null,
    kind: 'kanban_template',
    slug: 'ops-1a2b3c',
    name: 'Ops',
    summary: null,
    body: { lanes: [] },
    category: 'ops',
    tags: null,
    version: '1',
    visibility: 'private',
    priceCents: null,
    currency: null,
    publisherRef: null,
    installCount: 0,
    createdBy: null,
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

/** What 1263 writes for a published, priced template with two lanes, out of order. */
const MIGRATED_BODY = {
  teamType: 'Platform squad',
  parentTemplateId: 'standard-swe',
  pricingModel: 'flat_fee',
  lanes: [
    {
      key: 'review', name: 'Review', position: 1, isTerminal: false, gate: 'human', requirementGate: 'hard',
      requirements: [
        { kind: 'review', ref: 'code_reviewer', responsibility: 'reviewer', isRequired: true, description: null, position: 1, ticketType: null, quorum: 2, condition: 'has_pr' },
        { kind: 'role', ref: 'engineer', responsibility: null, isRequired: false, description: 'Builds it', position: 0, ticketType: 'feature', quorum: null, condition: null },
      ],
    },
    {
      key: 'todo', name: 'To do', position: 0, isTerminal: false, gate: 'auto', requirementGate: 'soft',
      requirements: [],
    },
  ],
};

describe('kanbanTemplateFromStored (reading a 1263-migrated row)', () => {
  const t = kanbanTemplateFromStored(stored({
    body: MIGRATED_BODY,
    summary: 'The ops board',
    version: '3',
    visibility: 'public',
    publishedAt: '2026-02-01T00:00:00.000Z',
    priceCents: 1200,
    createdBy: 'user-7',
    installCount: 4,
  }), 9);

  it('maps the shared columns', () => {
    expect(t).toMatchObject({
      name: 'Ops', slug: 'ops-1a2b3c', description: 'The ops board', category: 'ops', builtin: false,
      visibility: 'public', published: true, priceCents: 1200, installCount: 4, version: 3, authorId: 'user-7',
    });
  });

  it('maps the kanban-only payload out of the body', () => {
    expect(t.teamType).toBe('Platform squad');
    expect(t.parentTemplateId).toBe('standard-swe');
    expect(t.pricingModel).toBe('flat_fee');
    expect(t.priceUnit).toBeNull();
  });

  it('orders lanes and requirements by position and normalises nulls', () => {
    expect(t.lanes.map((l) => l.key)).toEqual(['todo', 'review']);
    const review = t.lanes[1]!;
    expect(review.gate).toBe('human');
    expect(review.requirementGate).toBe('hard');
    expect(review.requirements.map((r) => r.ref)).toEqual(['engineer', 'code_reviewer']);
    expect(review.requirements[0]).toMatchObject({ responsibility: undefined, isRequired: false, description: 'Builds it', ticketType: 'feature', quorum: null, condition: null });
    expect(review.requirements[1]).toMatchObject({ responsibility: 'reviewer', quorum: 2, condition: 'has_pr' });
  });

  it('is unpublished when published_at is null, and version falls back to 1', () => {
    const draft = kanbanTemplateFromStored(stored({ version: 'garbage' }), 9);
    expect(draft.published).toBe(false);
    expect(draft.version).toBe(1);
    expect(draft.category).toBe('ops');
  });
});

describe('authorId is the owning workspace\'s business only', () => {
  const row = stored({ tenantId: 9, createdBy: 'user-7', visibility: 'public', publishedAt: '2026-02-01T00:00:00.000Z' });

  it('the owning workspace sees its author', () => {
    expect(kanbanTemplateFromStored(row, 9).authorId).toBe('user-7');
  });

  it('another workspace previewing / installing a public template does not', () => {
    expect(kanbanTemplateFromStored(row, 10).authorId).toBeNull();
  });

  it('an anonymous marketplace read does not', () => {
    expect(kanbanTemplateFromStored(row, null).authorId).toBeNull();
  });
});

describe('parseKanbanBody tolerance', () => {
  it('drops only a lane with no key or a requirement with no kind / ref', () => {
    const body = parseKanbanBody({
      lanes: [
        { name: 'no key' },
        { key: 'ok', requirements: [{ kind: 'role' }, { ref: 'orphan' }, { kind: 'role', ref: 'qa', position: 1 }] },
      ],
    });
    expect(body.lanes).toHaveLength(1);
    expect(body.lanes[0]!.requirements.map((r) => r.ref)).toEqual(['qa']);
    expect(body.lanes[0]!.requirementGate).toBe('soft');
  });

  it('keeps an unknown requirement kind, responsibility and condition VERBATIM', () => {
    const body = parseKanbanBody({
      lanes: [{
        key: 'ship',
        requirements: [{ kind: 'attestation', ref: 'legal', responsibility: 'approver', condition: 'is_regulated', position: 0 }],
      }],
    });
    const [req] = body.lanes[0]!.requirements;
    expect(req).toMatchObject({ kind: 'attestation', ref: 'legal', responsibility: 'approver', condition: 'is_regulated' });
    // and it survives the next write unchanged
    const rewritten = parseKanbanBody(JSON.parse(JSON.stringify(kanbanBodyOf({ lanes: body.lanes }))));
    expect(rewritten.lanes[0]!.requirements[0]).toMatchObject({ kind: 'attestation', condition: 'is_regulated' });
  });

  it('treats a missing body as no lanes', () => {
    expect(parseKanbanBody(null)).toMatchObject({ lanes: [] });
  });

  it('keeps the 1263 legacy id', () => {
    expect(parseKanbanBody({ legacyId: 'old-id', lanes: [] }).legacyId).toBe('old-id');
  });
});

describe('kanbanBodyOf → kanbanTemplateFromStored round trip', () => {
  it('a written template reads back identically', () => {
    const lanes: TemplateLane[] = [
      { key: 'todo', name: 'To do', position: 0, isTerminal: false, gate: 'auto', requirementGate: 'soft', requirements: [] },
      {
        key: 'done', name: 'Done', position: 1, isTerminal: true, gate: 'human', requirementGate: 'off',
        requirements: [{ kind: 'diagnostic', ref: 'lint', isRequired: true, position: 0, ticketType: null, quorum: null, condition: null }],
      },
    ];
    const body = kanbanBodyOf({ teamType: 'Squad', parentTemplateId: null, pricingModel: null, priceUnit: 'seat', lanes, legacyId: 'abc' });
    const back = kanbanTemplateFromStored(stored({ body: JSON.parse(JSON.stringify(body)) }), 9);
    expect(back.lanes).toEqual(lanes);
    expect(back.teamType).toBe('Squad');
    expect(back.priceUnit).toBe('seat');
    expect(parseKanbanBody(body).legacyId).toBe('abc');
  });
});

describe('kanbanPriceValues', () => {
  it('leaves price alone when not given, clears currency with the price, and prices in usd', () => {
    expect(kanbanPriceValues(undefined)).toEqual({});
    expect(kanbanPriceValues(null)).toEqual({ priceCents: null, currency: null });
    expect(kanbanPriceValues(900)).toEqual({ priceCents: 900, currency: 'usd' });
  });
});
