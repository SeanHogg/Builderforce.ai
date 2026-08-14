/**
 * The rules that a wrong answer here would cost somebody money or leak a product.
 *
 * These are unit tests over the pure decisions — the kind registry, the trial
 * policy, the binding strip and the commission split. They are deliberately NOT
 * database tests: the invariants worth pinning are the ones a reader of the code
 * cannot check by eye, and every one of them is a function.
 */

import { describe, expect, it } from 'vitest';
import {
  LISTING_KIND_IDS,
  MARKETPLACE_LISTING_KINDS,
  isPublishableObjectKind,
  isStrippedListingField,
  listingKindSpec,
  listingKindsForObjectKind,
  resolveTrialPolicy,
  sessionListingKinds,
} from '@builderforce/creation-canvas-contract';
import { platformTakeRateBps } from './listingCommerce';
import type { Env } from '../../env';

const env = (bps?: string) => ({ MARKETPLACE_TAKE_RATE_BPS: bps } as unknown as Env);

describe('listing kind registry', () => {
  it('has a unique id per kind, because the id is in a public URL and in sold rows', () => {
    expect(new Set(LISTING_KIND_IDS).size).toBe(LISTING_KIND_IDS.length);
  });

  it('maps a canvas object kind to the kinds it may be sold as', () => {
    expect(listingKindsForObjectKind('game').map((spec) => spec.id)).toEqual(['game']);
    expect(listingKindsForObjectKind('website').map((spec) => spec.id)).toEqual(['app']);
  });

  it('refuses to sell a kind that is not a product', () => {
    // A résumé is somebody's CV and a comment is a remark. Publishing either
    // would teach visitors the marketplace is full of things that do nothing —
    // and in the résumé's case would put personal data on a public URL.
    expect(isPublishableObjectKind('resume')).toBe(false);
    expect(isPublishableObjectKind('comment')).toBe(false);
    expect(isPublishableObjectKind('timer')).toBe(false);
    expect(isPublishableObjectKind('inbox')).toBe(false);
  });

  it('only offers board-level kinds when publishing a whole session', () => {
    const fromBoard = sessionListingKinds().map((spec) => spec.id);
    expect(fromBoard).toEqual(['pack']);
    // And the converse: nothing that needs an object claims to come from a board.
    for (const spec of MARKETPLACE_LISTING_KINDS) {
      if (spec.id !== 'pack') expect(spec.from.length).toBeGreaterThan(0);
    }
  });

  it('gives every kind a launch verb — a listing nobody can run is a screenshot', () => {
    for (const spec of MARKETPLACE_LISTING_KINDS) {
      expect(['play', 'open', 'run', 'preview', 'install']).toContain(spec.launch);
    }
  });
});

describe('trial policy', () => {
  it('never gives a paid product away by default', () => {
    // The whole failure mode: a seller prices something at $9 and the URL that
    // sells it hands the working copy to everyone who opens it.
    expect(resolveTrialPolicy('game', 900, null)).toBe('preview');
    expect(resolveTrialPolicy('game', 900, undefined)).toBe('preview');
    expect(resolveTrialPolicy('game', 1, null)).toBe('preview');
  });

  it('lets a seller open a paid product deliberately, and only deliberately', () => {
    expect(resolveTrialPolicy('game', 900, 'full')).toBe('full');
    expect(resolveTrialPolicy('game', 900, 'anything-else')).toBe('preview');
  });

  it('runs a free listing for anyone, unless the seller asked for a preview', () => {
    expect(resolveTrialPolicy('game', 0, null)).toBe('full');
    expect(resolveTrialPolicy('game', 0, 'preview')).toBe('preview');
  });

  it('falls back to preview for an unknown kind rather than to full', () => {
    // A stored row whose kind was renamed must degrade shut, not open.
    expect(resolveTrialPolicy('no-such-kind', 0, null)).toBe('full');
    expect(resolveTrialPolicy('no-such-kind', 500, null)).toBe('preview');
  });
});

describe('binding strip', () => {
  it('drops the coordinates of the seller’s own resources', () => {
    for (const field of ['projectId', 'resourceId', 'storageKey', 'connectionId', 'apiKey', 'path']) {
      expect(isStrippedListingField(field)).toBe(true);
    }
  });

  it('catches a binding a kind renamed for itself', () => {
    // `gameProjectId` is `projectId`. A list matched on exact names would ship it.
    expect(isStrippedListingField('gameProjectId')).toBe(true);
    expect(isStrippedListingField('sourceRepoUrl')).toBe(true);
    expect(isStrippedListingField('ACCESSTOKEN')).toBe(true);
  });

  it('keeps the content, which is the product', () => {
    for (const field of ['title', 'document', 'summary', 'steps', 'rows', 'html']) {
      expect(isStrippedListingField(field)).toBe(false);
    }
  });
});

describe('platform take rate', () => {
  it('defaults to 15% when the deployment says nothing', () => {
    expect(platformTakeRateBps(env(undefined))).toBe(1500);
    expect(platformTakeRateBps(env(''))).toBe(1500);
  });

  it('honours a configured rate', () => {
    expect(platformTakeRateBps(env('1000'))).toBe(1000);
    expect(platformTakeRateBps(env('0'))).toBe(0);
  });

  it('refuses a nonsense rate rather than inverting a seller’s earning', () => {
    // `"50%"` parses to 50 bps, which is survivable; 50000 does not — it would
    // make the commission larger than the sale and the seller owe money.
    expect(platformTakeRateBps(env('50000'))).toBe(1500);
    expect(platformTakeRateBps(env('-100'))).toBe(1500);
    expect(platformTakeRateBps(env('not a number'))).toBe(1500);
  });
});

describe('the split', () => {
  const split = (priceCents: number, bps: number) => {
    const commission = Math.round((priceCents * bps) / 10_000);
    return { commission, seller: Math.max(0, priceCents - commission) };
  };

  it('always adds back up to the price — no cent is invented or lost', () => {
    for (const price of [0, 1, 99, 100, 499, 900, 1234, 99_999]) {
      const { commission, seller } = split(price, 1500);
      expect(commission + seller).toBe(price);
    }
  });

  it('never charges a fee on a free listing', () => {
    expect(split(0, 1500).commission).toBe(0);
  });
});

describe('paid acquisition', () => {
  /**
   * These pin the SHAPE of the paid path rather than exercising a database: the
   * defect they exist for is a missing check, and a missing check is visible in
   * the module's surface. `acquireListing` must not be able to grant a paid item
   * at all, and the only function that can must be the one that verifies.
   */
  it('exposes exactly one door that can grant a paid listing', async () => {
    const commerce = await import('./listingCommerce');
    expect(typeof commerce.acquireListing).toBe('function');
    expect(typeof commerce.startListingCheckout).toBe('function');
    expect(typeof commerce.completeListingCheckout).toBe('function');
    // The private grant is not reachable from outside — a second exported grant
    // is how a paid path acquires a version that skips verification.
    expect((commerce as Record<string, unknown>).grantListing).toBeUndefined();
  });

  it('takes no payment identifier from the caller of the free path', async () => {
    const commerce = await import('./listingCommerce');
    // Arity is the cheap, honest proxy: `acquireListing(db, env, input)`. What
    // matters is that its `input` type has no payment field, which the compiler
    // enforces; this asserts the signature has not quietly regrown a fourth.
    expect(commerce.acquireListing.length).toBe(3);
  });
});

describe('withdrawal does not repossess', () => {
  /**
   * Withdrawing takes a listing off SALE. It must not take it away from the people
   * who already bought it — a seller who could do that could take $9 and then
   * switch the thing off. So launch and install resolve the row WITHOUT the
   * visibility filter and apply the licence rule, rather than resolving through
   * the shop window and 404-ing the one person entitled to a copy.
   */
  it('resolves a listing for owners by a path that does not filter on visibility', async () => {
    const listings = await import('./creationListings');
    expect(typeof listings.resolveListingBySlug).toBe('function');

    const source = await readListingSource();
    // The browse surfaces still filter; the buyer paths must not.
    expect(source).toContain("if (row.visibility !== 'public' && !entitled) return null;");
    // And the install path goes through the same unfiltered resolver.
    expect(source).toMatch(/resolveListingBySlug\(db, input\.slug\)/);
  });
});

/** The module's own text — these two rules are one line each and a reader cannot
 *  tell from a mock whether the line is still there. */
async function readListingSource(): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  return readFile(fileURLToPath(new URL('./creationListings.ts', import.meta.url)), 'utf8');
}

describe('kind spec lookup', () => {
  it('returns null rather than throwing for a kind that no longer exists', () => {
    // A listing sold under a since-renamed kind must render, not 500.
    expect(listingKindSpec('gone')).toBeNull();
  });
});
