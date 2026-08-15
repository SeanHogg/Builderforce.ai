/**
 * What Stage refuses, and what it merely declares.
 *
 * These assertions are the gate itself. Every `block` below is a defect that would
 * otherwise reach a buyer — and every `warn` is a fact about the buyer's environment
 * that must NOT refuse a publish, because a gate that blocks on the buyer's printer
 * teaches sellers to ignore the panel.
 */

import { describe, expect, it } from 'vitest';
import {
  LISTING_HARNESSES,
  MARKETPLACE_LISTING_KINDS,
  blockingChecks,
  isPublishable,
  listingKindSpec,
  resolveListingHarness,
} from '@builderforce/creation-canvas-contract';
import { runStageChecks, type StageInput, type StageObject } from './stageChecks';

function object(kind: string, canvasData: Record<string, unknown>): StageObject {
  return { id: `obj-${kind}`, kind, canvasData, content: null };
}

function input(partial: Partial<StageInput> & Pick<StageInput, 'listingKind' | 'objects'>): StageInput {
  return {
    objectKind: null,
    priceCents: 0,
    trial: 'full',
    strippedFields: [],
    ...partial,
  };
}

const codes = (checks: ReturnType<typeof runStageChecks>) => checks.map((check) => check.code);
const severityOf = (checks: ReturnType<typeof runStageChecks>, code: string) =>
  checks.find((check) => check.code === code)?.severity;

describe('the registry', () => {
  it('gives every sellable kind a harness, and every harness a runner', () => {
    for (const spec of MARKETPLACE_LISTING_KINDS) {
      expect(LISTING_HARNESSES).toContain(spec.harness);
    }
    // Every harness must be reachable BY A REAL PUBLISH, or a runner exists that
    // nothing can dispatch to — dead code that looks like coverage.
    //
    // Reachability is asked through `resolveListingHarness` over every source kind
    // each listing kind accepts, not off the `harness` defaults: `geometry` is
    // reachable only via the source-kind override (a `model3d` sold as `creative`),
    // and a test that read the defaults alone would call it dead while it is the
    // thing exercising every 3D model on the platform.
    const reachable = new Set(
      MARKETPLACE_LISTING_KINDS.flatMap((spec) => [
        resolveListingHarness(spec.id, null),
        ...spec.from.map((objectKind) => resolveListingHarness(spec.id, objectKind)),
      ]),
    );
    for (const harness of LISTING_HARNESSES) expect(reachable.has(harness)).toBe(true);
  });

  it('resolves the harness from the SOURCE kind, because `creative` spans three', () => {
    // The case the whole override map exists for: one listing kind, three output
    // shapes. Getting this wrong shows a seller a print proof for a video.
    expect(resolveListingHarness('creative', 'video')).toBe('media');
    expect(resolveListingHarness('creative', 'comic')).toBe('paged');
    expect(resolveListingHarness('creative', 'model3d')).toBe('geometry');
    // No source kind (a pack, published from a whole board) falls to the default.
    expect(resolveListingHarness('pack', null)).toBe('system');
    // An unknown kind must degrade rather than throw — a stored row may predate a
    // rename, and a listing whose kind no longer exists has to render.
    expect(resolveListingHarness('nonsense', null)).toBe('system');
  });

  it('can sell a survey and a book', () => {
    expect(listingKindSpec('survey')?.from).toContain('form');
    expect(listingKindSpec('survey')?.harness).toBe('instrument');
    expect(listingKindSpec('book')?.from).toContain('book');
    expect(resolveListingHarness('book', 'book')).toBe('paged');
    // An instrument someone can read in full is one they can copy.
    expect(listingKindSpec('survey')?.trial).toBe('preview');
  });
});

describe('travels — the journey out of the seller tenant', () => {
  it('BLOCKS when a stripped binding has no substitute for a buyer', () => {
    // The defect Stage exists to surface: it works perfectly on the seller's board,
    // where the connector is attached, and fails for every buyer.
    const checks = runStageChecks(input({
      listingKind: 'automation',
      objects: [object('workflow', { steps: [{ action: 'send' }] })],
      strippedFields: ['connectionId', 'projectId'],
    }));
    expect(severityOf(checks, 'travels.stripped')).toBe('block');
    expect(isPublishable(checks)).toBe(false);
  });

  it('only INFORMS when what was stripped is an internal id', () => {
    const checks = runStageChecks(input({
      listingKind: 'automation',
      objects: [object('workflow', { steps: [{ action: 'assign' }], setupInstructions: 'Add your team.' })],
      strippedFields: ['projectId', 'createdBy'],
    }));
    expect(severityOf(checks, 'travels.stripped')).toBe('pass');
    expect(isPublishable(checks)).toBe(true);
  });

  it('BLOCKS an empty card, which reaches the buyer as a blank', () => {
    const checks = runStageChecks(input({
      listingKind: 'pack',
      objects: [object('note', {}), object('document', { content: 'Real text' })],
    }));
    expect(severityOf(checks, 'travels.emptyObjects')).toBe('block');
  });
});

describe('harness · runtime', () => {
  const game = (document: string) => input({
    listingKind: 'game',
    objectKind: 'game',
    objects: [object('game', { document, posterUrl: 'https://example.test/p.png' })],
  });

  it('passes a self-contained, touch-capable document', () => {
    const checks = runStageChecks(game('<script>addEventListener("touchstart",()=>{})</script>'));
    expect(severityOf(checks, 'runtime.external')).toBe('pass');
    expect(severityOf(checks, 'runtime.touch')).toBe('pass');
    expect(isPublishable(checks)).toBe(true);
  });

  it('BLOCKS a CDN reference — the play frame is offline for the buyer', () => {
    const checks = runStageChecks(game('<script src="https://cdn.test/engine.js"></script>'));
    expect(severityOf(checks, 'runtime.external')).toBe('block');
  });

  it('BLOCKS a document with no script, and a payload with nothing runnable', () => {
    expect(severityOf(runStageChecks(game('<p>hello</p>')), 'runtime.script')).toBe('block');
    const nothing = runStageChecks(input({
      listingKind: 'game', objectKind: 'game', objects: [object('game', { title: 'Untitled' })],
    }));
    expect(severityOf(nothing, 'runtime.document')).toBe('block');
  });

  it('only WARNS about keyboard-only input', () => {
    const checks = runStageChecks(game('<script>addEventListener("keydown",()=>{})</script>'));
    expect(severityOf(checks, 'runtime.touch')).toBe('warn');
    expect(isPublishable(checks)).toBe(true);
  });
});

describe('harness · instrument', () => {
  const survey = (extra: Record<string, unknown>) => input({
    listingKind: 'survey',
    objectKind: 'form',
    objects: [object('form', {
      questions: [{ id: 'q_hours', label: 'Hours worked' }, { id: 'q_recover', label: 'How recoverable?' }],
      ...extra,
    })],
  });

  it('BLOCKS a question id that is missing or duplicated', () => {
    // Responses are keyed by question id. Nothing else on the platform notices this
    // until a buyer has thousands of answers pointing at an id that no longer exists.
    const missing = runStageChecks(survey({ questions: [{ id: '', label: 'Anonymous question' }] }));
    expect(severityOf(missing, 'instrument.stableIds')).toBe('block');

    const duplicated = runStageChecks(survey({
      questions: [{ id: 'q_a', label: 'One' }, { id: 'q_a', label: 'Two' }],
    }));
    expect(severityOf(duplicated, 'instrument.stableIds')).toBe('block');
  });

  it('BLOCKS shipping the seller’s own responses', () => {
    const checks = runStageChecks(survey({ responses: [{ respondent: '', submittedAt: '2026-01-01' }] }));
    expect(severityOf(checks, 'instrument.responses')).toBe('block');
  });

  it('BLOCKS an anonymous instrument that asks for a name', () => {
    const checks = runStageChecks(survey({
      anonymous: true,
      questions: [{ id: 'q_name', label: 'Your name' }, { id: 'q_ok', label: 'How is it going?' }],
    }));
    expect(severityOf(checks, 'instrument.anonymity')).toBe('block');
  });

  it('passes a coherent instrument with an empty response store', () => {
    const checks = runStageChecks(survey({ anonymous: true }));
    expect(blockingChecks(checks)).toHaveLength(0);
  });
});

describe('harness · paged', () => {
  const book = (extra: Record<string, unknown>) => input({
    listingKind: 'book',
    objectKind: 'book',
    objects: [object('book', {
      coverImageUrl: 'https://example.test/cover.png',
      pages: [{ page: '1', heading: 'One', body: 'Text' }, { page: '2', body: 'More' }],
      ...extra,
    })],
  });

  it('BLOCKS an empty page and a contents entry pointing past the end', () => {
    const blank = runStageChecks(book({ pages: [{ page: '1', body: 'Text' }, { page: '2' }] }));
    expect(severityOf(blank, 'paged.blankPages')).toBe('block');

    const dangling = runStageChecks(book({ contents: [{ chapter: '1', title: 'One', page: '99' }] }));
    expect(severityOf(dangling, 'paged.contents')).toBe('block');
  });

  it('BLOCKS the PRINT edition on resolution, and only when print was asked for', () => {
    const printing = runStageChecks(book({ formats: ['reader', 'pdf', 'print'], coverDpi: 72 }));
    expect(severityOf(printing, 'paged.printDpi')).toBe('block');

    // Digital-only never asks the question — the reader and the PDF are fine at 72.
    const digital = runStageChecks(book({ formats: ['reader', 'pdf'], coverDpi: 72 }));
    expect(codes(digital)).not.toContain('paged.printDpi');
    expect(isPublishable(digital)).toBe(true);
  });

  it('only WARNS about missing alt text, and counts it', () => {
    const checks = runStageChecks(book({
      figures: [{ ref: 'f1', caption: 'One' }, { ref: 'f2', caption: 'Two', altText: 'Described' }],
    }));
    expect(severityOf(checks, 'paged.altText')).toBe('warn');
    expect(checks.find((check) => check.code === 'paged.altText')?.label).toContain('1 of 2');
  });
});

describe('harness · geometry', () => {
  const part = (extra: Record<string, unknown>) => input({
    listingKind: 'creative',
    objectKind: 'model3d',
    objects: [object('model3d', { units: 'mm', formats: ['stl'], ...extra })],
  });

  it('BLOCKS a model with no unit — it prints at ten times the size', () => {
    const checks = runStageChecks(input({
      listingKind: 'creative',
      objectKind: 'model3d',
      objects: [object('model3d', { formats: ['stl'] })],
    }));
    expect(severityOf(checks, 'geometry.units')).toBe('block');
  });

  it('BLOCKS a non-manifold mesh and a model with no exchange format', () => {
    expect(severityOf(runStageChecks(part({ manifold: false })), 'geometry.manifold')).toBe('block');
    expect(severityOf(runStageChecks(part({ formats: [] })), 'geometry.formats')).toBe('block');
  });

  it('only WARNS on a thin wall, because that is a fact about the buyer’s printer', () => {
    const checks = runStageChecks(part({ minWallThicknessMm: 1.2 }));
    expect(severityOf(checks, 'geometry.wall')).toBe('warn');
    expect(isPublishable(checks)).toBe(true);
  });
});

describe('harness · media', () => {
  const reel = (extra: Record<string, unknown>) => input({
    listingKind: 'creative',
    objectKind: 'video',
    objects: [object('video', { durationSeconds: 38, posterUrl: 'https://example.test/p.png', ...extra })],
  });

  it('BLOCKS a cloned voice, which does not transfer to the buyer', () => {
    const checks = runStageChecks(reel({ voiceCloneId: 'vc_123' }));
    expect(severityOf(checks, 'media.voiceClone')).toBe('block');
  });

  it('BLOCKS a listing with nothing to play', () => {
    const checks = runStageChecks(input({
      listingKind: 'creative', objectKind: 'video', objects: [object('video', { title: 'Untitled' })],
    }));
    expect(severityOf(checks, 'media.duration')).toBe('block');
  });

  it('WARNS about an uncaptioned visual track', () => {
    const checks = runStageChecks(reel({ scenes: [{ id: 's1' }] }));
    expect(severityOf(checks, 'media.captions')).toBe('warn');
  });
});

describe('harness · system', () => {
  it('BLOCKS an empty shell', () => {
    const checks = runStageChecks(input({
      listingKind: 'dashboard', objectKind: 'dashboard', objects: [object('dashboard', { title: 'Ops' })],
    }));
    expect(severityOf(checks, 'system.body')).toBe('block');
  });

  it('WARNS when nothing is bound and when there is no first-run setup', () => {
    const checks = runStageChecks(input({
      listingKind: 'dashboard',
      objectKind: 'dashboard',
      objects: [object('dashboard', { widgets: [{ id: 'w1' }] })],
    }));
    expect(severityOf(checks, 'system.bindings')).toBe('warn');
    expect(severityOf(checks, 'system.firstRun')).toBe('warn');
    expect(isPublishable(checks)).toBe(true);
  });
});

describe('sells', () => {
  it('warns when a priced listing gives the whole thing away at the URL that sells it', () => {
    const checks = runStageChecks(input({
      listingKind: 'game',
      objectKind: 'game',
      objects: [object('game', { document: '<script>ontouchstart</script>' })],
      priceCents: 900,
      trial: 'full',
    }));
    expect(severityOf(checks, 'sells.trial')).toBe('warn');
    // Deliberate, so it must not refuse the publish.
    expect(severityOf(checks, 'sells.poster')).toBe('warn');
    expect(isPublishable(checks)).toBe(true);
  });
});

describe('the panel reads the same verdict as the gate', () => {
  it('sorts blockers first, so a refusal is never below four passes', () => {
    const checks = runStageChecks(input({
      listingKind: 'game',
      objectKind: 'game',
      objects: [object('game', { document: '<p>no script</p>' })],
    }));
    expect(checks[0]?.severity).toBe('block');
  });

  it('is pure — the same input twice gives the same findings', () => {
    const build = () => runStageChecks(input({
      listingKind: 'book',
      objectKind: 'book',
      objects: [object('book', { pages: [{ page: '1', body: 'Text' }] })],
    }));
    expect(codes(build())).toEqual(codes(build()));
  });
});
