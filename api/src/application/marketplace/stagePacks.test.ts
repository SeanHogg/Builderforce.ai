/**
 * A founder at a business stage can find that stage's starter toolkit and
 * install it through the ordinary pack path.
 *
 * The feed has no stage filter, so the tag is applied here. Install is not
 * reimplemented: the test drives `installListingIntoCanvas` by calling
 * `installStagePack`, and the seed drives `publishCreationListing`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BUSINESS_STAGES, isPublishable } from '@builderforce/creation-canvas-contract';
import { fakeDb, type FakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { invalidateListingCaches } from './creationListings';
import { runStageChecks } from './stageChecks';
import {
  STAGE_TOOLKIT_TAG,
  ensureStageToolkits,
  findStagePack,
  installStagePack,
  stageOfToolkit,
  stageToolkitCard,
  stageToolkitSpecs,
} from './stagePacks';

const env = {} as Env;
const TENANT = 7;
const USER = 'user-1';

function dbOf(results: Array<unknown[] | Error>): FakeDb & { batch: (stmts: Array<PromiseLike<unknown>>) => Promise<unknown[]> } {
  const db = fakeDb(results) as FakeDb & { batch: (stmts: Array<PromiseLike<unknown>>) => Promise<unknown[]> };
  // `installListingIntoCanvas` writes the copy with `db.batch`. The double has
  // no batch; settling the three inserts is what the production call does.
  db.batch = (stmts) => Promise.all(stmts);
  return db;
}

function asDb(db: FakeDb): Db {
  return db as unknown as Db;
}

beforeEach(async () => {
  // Browse and snapshot reads are cached in-process. A leftover page from the
  // previous test would skip the queued select and the assertions would be
  // reading the wrong founder.
  await invalidateListingCaches(env);
});

function listingRow(stage: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date('2026-10-18T00:00:00.000Z');
  const slug = `stage-toolkit-${stage}`;
  return {
    id: `listing-${stage}`,
    tenantId: TENANT,
    slug,
    kind: 'pack',
    name: `${stage} starter toolkit`,
    summary: 'A starter toolkit',
    category: 'toolkit',
    tags: [STAGE_TOOLKIT_TAG, stage],
    version: '1.0.0',
    visibility: 'public',
    priceCents: 0,
    currency: 'USD',
    installCount: 0,
    rating: null,
    publishedAt: now,
    updatedAt: now,
    publisherRef: USER,
    body: {
      snapshotId: `snap-${stage}`,
      launch: 'install',
      trial: 'full',
      delivery: 'copy',
      seller: { userId: USER, name: 'Ada' },
      source: { sessionId: `sess-${stage}`, objectId: null, objectKind: null },
    },
    ...overrides,
  };
}

describe('stage toolkit cards', () => {
  it('covers every business stage and no other vocabulary', () => {
    const stages = stageToolkitSpecs().map((spec) => spec.stage);
    expect(stages).toEqual([...BUSINESS_STAGES]);
    expect(new Set(stages).size).toBe(BUSINESS_STAGES.length);
  });

  it('publishes as a pack: Stage accepts the card, and the tags name one stage', async () => {
    for (const spec of stageToolkitSpecs()) {
      const card = stageToolkitCard(spec);
      expect(stageOfToolkit([STAGE_TOOLKIT_TAG, spec.stage])).toBe(spec.stage);
      // A pack that merely mentions the stage, without the toolkit tag, is not one.
      expect(stageOfToolkit([spec.stage])).toBeNull();
      const checks = await runStageChecks({
        listingKind: 'pack',
        objectKind: null,
        objects: [card],
        priceCents: 0,
        trial: 'full',
        strippedFields: [],
        delivery: 'copy',
      });
      expect(isPublishable(checks), spec.stage).toBe(true);
      expect(card.content.instructions).toEqual(expect.any(String));
      expect((card.content.instructions as string).length).toBeGreaterThan(20);
    }
  });
});

describe('findStagePack', () => {
  it('returns the mvp toolkit and not a pack that only shares the word', async () => {
    const rows = [
      listingRow('idea'),
      listingRow('mvp'),
      listingRow('growth'),
      listingRow('early_revenue'),
      listingRow('scale'),
      listingRow('mvp', {
        id: 'listing-decoy',
        slug: 'mvp-notes',
        name: 'MVP notes starter toolkit',
        tags: ['mvp'],
      }),
    ];
    const db = dbOf([rows, [{ total: rows.length }]]);
    const found = await findStagePack(asDb(db), env, 'mvp');
    expect(found?.slug).toBe('stage-toolkit-mvp');
    expect(found?.tags).toEqual([STAGE_TOOLKIT_TAG, 'mvp']);
    expect(db.remaining()).toBe(0);
  });
});

describe('installStagePack', () => {
  it('refuses when the company has no business stage', async () => {
    const db = dbOf([[]]);
    await expect(installStagePack(asDb(db), env, { tenantId: TENANT, userId: USER }))
      .rejects.toThrow(/business stage/i);
  });

  it('installs the mvp pack for a founder at that stage, through the pack copy path', async () => {
    const mvp = listingRow('mvp');
    const card = stageToolkitCard(stageToolkitSpecs().find((spec) => spec.stage === 'mvp')!);
    const db = dbOf([
      [{ businessStage: 'mvp' }],
      [listingRow('idea'), mvp, listingRow('growth'), listingRow('mvp', { id: 'decoy', slug: 'mvp-notes', tags: ['mvp'] })],
      [{ total: 4 }],
      [mvp],
      [{
        payload: {
          kind: 'session',
          title: mvp.name,
          objects: [{ id: card.id, kind: card.kind, canvasData: card.canvasData, content: card.content }],
          connections: [],
        },
      }],
      [],
      [],
      [],
      [{ id: 'installed-session-object' }],
    ]);

    const installed = await installStagePack(asDb(db), env, { tenantId: TENANT, userId: USER });

    expect(installed.stage).toBe('mvp');
    expect(installed.slug).toBe('stage-toolkit-mvp');
    expect(installed.objectCount).toBe(1);
    expect(installed.sessionId).toEqual(expect.any(String));

    const copied = db.calls.find((call) => {
      const payload = call.payload;
      return call.kind === 'insert' && Array.isArray(payload) && payload[0]?.content?.stage === 'mvp';
    });
    expect(copied, 'install must copy the snapshot card onto a new board').toBeTruthy();
    const content = (copied!.payload as Array<{ content: { instructions: string; stage: string } }>)[0]!.content;
    expect(content.stage).toBe('mvp');
    expect(content.instructions.length).toBeGreaterThan(20);
    expect(db.remaining()).toBe(0);
  });
});

describe('ensureStageToolkits', () => {
  it('does not publish a second copy when every stage is already on the feed', async () => {
    const rows = BUSINESS_STAGES.map((stage) => listingRow(stage));
    const db = dbOf([rows, [{ total: rows.length }]]);
    const views = await ensureStageToolkits(asDb(db), env, { tenantId: TENANT, userId: USER });
    expect(views.map((view) => stageOfToolkit(view.tags))).toEqual([...BUSINESS_STAGES]);
    expect(db.calls.filter((call) => call.kind === 'insert')).toHaveLength(0);
    expect(db.remaining()).toBe(0);
  });

  it('publishes a missing toolkit through the pack listing path', async () => {
    const specs = stageToolkitSpecs();
    const queue: unknown[][] = [[], [{ total: 0 }]];
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      if (!spec) continue;
      const card = stageToolkitCard(spec);
      queue.push(
        // The board batch: session, registry object, owner membership (no camera, so no
        // presence row).
        [], [], [{ role: 'owner' }],
        [],
        [{ id: `sess-${i}`, title: spec.name }],
        [{ displayName: 'Ada', username: 'ada' }],
        [{ id: `reg-${i}` }],
        [{ id: card.id, kind: card.kind, canvasData: card.canvasData, content: card.content }],
        [{ id: `snap-${i}` }],
        [],
        [listingRow(spec.stage, { name: spec.name, summary: spec.summary })],
      );
    }
    const db = dbOf(queue);
    const views = await ensureStageToolkits(asDb(db), env, { tenantId: TENANT, userId: USER });

    expect(views).toHaveLength(BUSINESS_STAGES.length);
    const packs = db.calls.filter((call) => {
      const payload = call.payload as { kind?: string; tags?: string[] } | undefined;
      return call.kind === 'insert' && payload?.kind === 'pack';
    });
    expect(packs.map((call) => (call.payload as { tags: string[] }).tags)).toEqual(
      specs.map((spec) => [STAGE_TOOLKIT_TAG, spec.stage]),
    );
    const cards = db.calls.filter((call) => {
      const payload = call.payload as { content?: { instructions?: string } } | undefined;
      return call.kind === 'insert' && typeof payload?.content?.instructions === 'string';
    });
    expect(cards).toHaveLength(BUSINESS_STAGES.length);
    expect(db.remaining()).toBe(0);
  });
});
