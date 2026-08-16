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
  STAGE_SANDBOX_LIMIT_CODE,
  blockingChecks,
  declaredLimits,
  isPublishable,
  listingKindSpec,
  resolveListingAccess,
  resolveHostedLifecycle,
  resolveListingHarness,
  type StageCheck,
} from '@builderforce/creation-canvas-contract';
import {
  runStageChecks,
  type DeploymentProbeResult,
  type StageInput,
  type StageObject,
} from './stageChecks';

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

/** A stub address. The runner takes a port precisely so this is a literal rather
 *  than a network condition CI has to reproduce. */
const probing = (result: Partial<DeploymentProbeResult>) =>
  async (url: string): Promise<DeploymentProbeResult> =>
    ({ url, root: 'ok', health: 'ok', ...result });

const codes = (checks: readonly StageCheck[]) => checks.map((check) => check.code);
const severityOf = (checks: readonly StageCheck[], code: string) =>
  checks.find((check) => check.code === code)?.severity;

describe('the registry', () => {
  it('gives every sellable kind a harness, and every harness a runner', async () => {
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
    //
    // The DELIVERY axis is part of that reachability now: `deployment` is reachable
    // only for a kind that declares `hosted`, and asking over the source kinds alone
    // would call the one runner that checks a live address dead code.
    const reachable = new Set(
      MARKETPLACE_LISTING_KINDS.flatMap((spec) => [
        resolveListingHarness(spec.id, null),
        ...spec.from.map((objectKind) => resolveListingHarness(spec.id, objectKind)),
        ...spec.deliveries.flatMap((delivery) => [
          resolveListingHarness(spec.id, null, delivery),
          ...spec.from.map((objectKind) => resolveListingHarness(spec.id, objectKind, delivery)),
        ]),
      ]),
    );
    for (const harness of LISTING_HARNESSES) expect(reachable.has(harness)).toBe(true);
  });

  it('lets DELIVERY overrule the output shape, and only for hosted', () => {
    // A `website` sold as a copy is a runnable document; the same website sold as
    // access is an address somebody keeps operating, and asking the captured document
    // whether it works answers a question nobody is buying.
    expect(resolveListingHarness('app', 'website')).toBe('runtime');
    expect(resolveListingHarness('app', 'website', 'copy')).toBe('runtime');
    expect(resolveListingHarness('app', 'website', 'hosted')).toBe('deployment');
    // Nothing else on the platform can be hosted, so nothing else can reach it by
    // posting the string.
    expect(listingKindSpec('book')?.deliveries).toEqual(['copy']);
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

  it('can sell a survey and a book', async () => {
    expect(listingKindSpec('survey')?.from).toContain('form');
    expect(listingKindSpec('survey')?.harness).toBe('instrument');
    expect(listingKindSpec('book')?.from).toContain('book');
    expect(resolveListingHarness('book', 'book')).toBe('paged');
    // An instrument someone can read in full is one they can copy.
    expect(listingKindSpec('survey')?.trial).toBe('preview');
  });
});

describe('travels — the journey out of the seller tenant', () => {
  it('BLOCKS when a stripped binding has no substitute for a buyer', async () => {
    // The defect Stage exists to surface: it works perfectly on the seller's board,
    // where the connector is attached, and fails for every buyer.
    const checks = await runStageChecks(input({
      listingKind: 'automation',
      objects: [object('workflow', { steps: [{ action: 'send' }] })],
      strippedFields: ['connectionId', 'projectId'],
    }));
    expect(severityOf(checks, 'travels.stripped')).toBe('block');
    expect(isPublishable(checks)).toBe(false);
  });

  it('only INFORMS when what was stripped is an internal id', async () => {
    const checks = await runStageChecks(input({
      listingKind: 'automation',
      objects: [object('workflow', { steps: [{ action: 'assign' }], setupInstructions: 'Add your team.' })],
      strippedFields: ['projectId', 'createdBy'],
    }));
    expect(severityOf(checks, 'travels.stripped')).toBe('pass');
    expect(isPublishable(checks)).toBe(true);
  });

  it('BLOCKS an empty card, which reaches the buyer as a blank', async () => {
    const checks = await runStageChecks(input({
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

  it('passes a self-contained, touch-capable document', async () => {
    const checks = await runStageChecks(game('<script>addEventListener("touchstart",()=>{})</script>'));
    expect(severityOf(checks, 'runtime.external')).toBe('pass');
    expect(severityOf(checks, 'runtime.touch')).toBe('pass');
    expect(isPublishable(checks)).toBe(true);
  });

  it('BLOCKS a CDN reference — the play frame is offline for the buyer', async () => {
    const checks = await runStageChecks(game('<script src="https://cdn.test/engine.js"></script>'));
    expect(severityOf(checks, 'runtime.external')).toBe('block');
  });

  it('BLOCKS a document with no script, and a payload with nothing runnable', async () => {
    expect(severityOf(await runStageChecks(game('<p>hello</p>')), 'runtime.script')).toBe('block');
    const nothing = await runStageChecks(input({
      listingKind: 'game', objectKind: 'game', objects: [object('game', { title: 'Untitled' })],
    }));
    expect(severityOf(nothing, 'runtime.document')).toBe('block');
  });

  it('only WARNS about keyboard-only input', async () => {
    const checks = await runStageChecks(game('<script>addEventListener("keydown",()=>{})</script>'));
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

  it('BLOCKS a question id that is missing or duplicated', async () => {
    // Responses are keyed by question id. Nothing else on the platform notices this
    // until a buyer has thousands of answers pointing at an id that no longer exists.
    const missing = await runStageChecks(survey({ questions: [{ id: '', label: 'Anonymous question' }] }));
    expect(severityOf(missing, 'instrument.stableIds')).toBe('block');

    const duplicated = await runStageChecks(survey({
      questions: [{ id: 'q_a', label: 'One' }, { id: 'q_a', label: 'Two' }],
    }));
    expect(severityOf(duplicated, 'instrument.stableIds')).toBe('block');
  });

  it('BLOCKS shipping the seller’s own responses', async () => {
    const checks = await runStageChecks(survey({ responses: [{ respondent: '', submittedAt: '2026-01-01' }] }));
    expect(severityOf(checks, 'instrument.responses')).toBe('block');
  });

  it('BLOCKS an anonymous instrument that asks for a name', async () => {
    const checks = await runStageChecks(survey({
      anonymous: true,
      questions: [{ id: 'q_name', label: 'Your name' }, { id: 'q_ok', label: 'How is it going?' }],
    }));
    expect(severityOf(checks, 'instrument.anonymity')).toBe('block');
  });

  it('passes a coherent instrument with an empty response store', async () => {
    const checks = await runStageChecks(survey({ anonymous: true }));
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

  it('BLOCKS an empty page and a contents entry pointing past the end', async () => {
    const blank = await runStageChecks(book({ pages: [{ page: '1', body: 'Text' }, { page: '2' }] }));
    expect(severityOf(blank, 'paged.blankPages')).toBe('block');

    const dangling = await runStageChecks(book({ contents: [{ chapter: '1', title: 'One', page: '99' }] }));
    expect(severityOf(dangling, 'paged.contents')).toBe('block');
  });

  it('BLOCKS the PRINT edition on resolution, and only when print was asked for', async () => {
    const printing = await runStageChecks(book({ formats: ['reader', 'pdf', 'print'], coverDpi: 72 }));
    expect(severityOf(printing, 'paged.printDpi')).toBe('block');

    // Digital-only never asks the question — the reader and the PDF are fine at 72.
    const digital = await runStageChecks(book({ formats: ['reader', 'pdf'], coverDpi: 72 }));
    expect(codes(digital)).not.toContain('paged.printDpi');
    expect(isPublishable(digital)).toBe(true);
  });

  it('only WARNS about missing alt text, and counts it', async () => {
    const checks = await runStageChecks(book({
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

  it('BLOCKS a model with no unit — it prints at ten times the size', async () => {
    const checks = await runStageChecks(input({
      listingKind: 'creative',
      objectKind: 'model3d',
      objects: [object('model3d', { formats: ['stl'] })],
    }));
    expect(severityOf(checks, 'geometry.units')).toBe('block');
  });

  it('BLOCKS a non-manifold mesh and a model with no exchange format', async () => {
    expect(severityOf(await runStageChecks(part({ manifold: false })), 'geometry.manifold')).toBe('block');
    expect(severityOf(await runStageChecks(part({ formats: [] })), 'geometry.formats')).toBe('block');
  });

  it('only WARNS on a thin wall, because that is a fact about the buyer’s printer', async () => {
    const checks = await runStageChecks(part({ minWallThicknessMm: 1.2 }));
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

  it('BLOCKS a cloned voice, which does not transfer to the buyer', async () => {
    const checks = await runStageChecks(reel({ voiceCloneId: 'vc_123' }));
    expect(severityOf(checks, 'media.voiceClone')).toBe('block');
  });

  it('BLOCKS a listing with nothing to play', async () => {
    const checks = await runStageChecks(input({
      listingKind: 'creative', objectKind: 'video', objects: [object('video', { title: 'Untitled' })],
    }));
    expect(severityOf(checks, 'media.duration')).toBe('block');
  });

  it('WARNS about an uncaptioned visual track', async () => {
    const checks = await runStageChecks(reel({ scenes: [{ id: 's1' }] }));
    expect(severityOf(checks, 'media.captions')).toBe('warn');
  });
});

describe('harness · system', () => {
  it('BLOCKS an empty shell', async () => {
    const checks = await runStageChecks(input({
      listingKind: 'dashboard', objectKind: 'dashboard', objects: [object('dashboard', { title: 'Ops' })],
    }));
    expect(severityOf(checks, 'system.body')).toBe('block');
  });

  it('WARNS when nothing is bound and when there is no first-run setup', async () => {
    const checks = await runStageChecks(input({
      listingKind: 'dashboard',
      objectKind: 'dashboard',
      objects: [object('dashboard', { widgets: [{ id: 'w1' }] })],
    }));
    expect(severityOf(checks, 'system.bindings')).toBe('warn');
    expect(severityOf(checks, 'system.firstRun')).toBe('warn');
    expect(isPublishable(checks)).toBe(true);
  });
});

describe('the Stage Sandbox composition', () => {
  const game = (document: string) => input({
    listingKind: 'game',
    objectKind: 'game',
    objects: [object('game', { document, posterUrl: 'https://example.test/p.png' })],
  });

  it('prefers a sandbox-driven runtime.touch finding over the regex when one is present', async () => {
    // The document itself has no touch handler (the regex would WARN), but the
    // sandbox ran a real gesture and observed a real reaction — that verdict wins.
    const checks = await runStageChecks({
      ...game('<script>/* no listener */</script>'),
      sandbox: {
        status: 'passed', runId: 'run-1', summary: 'Verified', errorMessage: null, lastVerifiedAt: null,
        findings: [{ code: 'runtime.touch', group: 'runs', severity: 'pass', label: 'Registers touch input, driven and observed' }],
      },
    });
    expect(severityOf(checks, 'runtime.touch')).toBe('pass');
  });

  it('BLOCKS on a sandbox-reported crash even though the regex would have passed the document', async () => {
    const checks = await runStageChecks({
      ...game('<script>addEventListener("touchstart",()=>{throw new Error("boom")})</script>'),
      sandbox: {
        status: 'failed', runId: 'run-2', summary: 'Threw', errorMessage: null, lastVerifiedAt: null,
        findings: [{ code: 'runtime.crash', group: 'runs', severity: 'block', label: 'Threw while booting in the sandbox' }],
      },
    });
    expect(severityOf(checks, 'runtime.crash')).toBe('block');
    expect(isPublishable(checks)).toBe(false);
  });

  it('falls back to the regex when no sandbox verdict is present', async () => {
    const checks = await runStageChecks(game('<script>addEventListener("touchstart",()=>{})</script>'));
    expect(severityOf(checks, 'runtime.touch')).toBe('pass');
  });

  it('BLOCKS publish while the sandbox is still queued or running', async () => {
    for (const status of ['queued', 'running'] as const) {
      const checks = await runStageChecks({
        ...game('<script>addEventListener("touchstart",()=>{})</script>'),
        sandbox: { status, runId: 'run-3', summary: null, errorMessage: null, lastVerifiedAt: null, findings: [] },
      });
      expect(severityOf(checks, 'sandbox.pending')).toBe('block');
      expect(isPublishable(checks)).toBe(false);
    }
  });

  it('BLOCKS publish when nothing has verified this exact build', async () => {
    const checks = await runStageChecks({
      ...game('<script>addEventListener("touchstart",()=>{})</script>'),
      sandbox: { status: 'missing', runId: null, summary: null, errorMessage: null, lastVerifiedAt: null, findings: [] },
    });
    expect(severityOf(checks, 'sandbox.missing')).toBe('block');
    expect(isPublishable(checks)).toBe(false);
  });

  it('fails OPEN when the sandbox itself could not finish, or the quota is exhausted', async () => {
    const unavailable = await runStageChecks({
      ...game('<script>addEventListener("touchstart",()=>{})</script>'),
      sandbox: { status: 'error', runId: 'run-4', summary: null, errorMessage: 'timed out', lastVerifiedAt: null, findings: [] },
    });
    expect(severityOf(unavailable, 'sandbox.unavailable')).toBe('warn');
    expect(isPublishable(unavailable)).toBe(true);

    const capped = await runStageChecks({
      ...game('<script>addEventListener("touchstart",()=>{})</script>'),
      sandbox: { status: 'capped', runId: null, summary: null, errorMessage: null, lastVerifiedAt: null, findings: [] },
    });
    expect(severityOf(capped, 'sandbox.capped')).toBe('warn');
    expect(isPublishable(capped)).toBe(true);
  });

  it('reports a voice clone that does not resolve to a real row differently from one that does', async () => {
    const reel = (voiceCloneId: string) => input({
      listingKind: 'creative',
      objectKind: 'video',
      objects: [object('video', { durationSeconds: 10, voiceCloneId, posterUrl: 'https://e.test/p.png' })],
    });

    const stale = await runStageChecks({ ...reel('vc_gone'), voiceClone: async () => 'unknown' });
    expect(severityOf(stale, 'media.voiceClone')).toBe('block');
    expect(stale.find((c) => c.code === 'media.voiceClone')?.label).toContain('no longer exists');

    const real = await runStageChecks({ ...reel('vc_real'), voiceClone: async () => 'seller_only' });
    expect(severityOf(real, 'media.voiceClone')).toBe('block');
    expect(real.find((c) => c.code === 'media.voiceClone')?.label).not.toContain('no longer exists');

    const transferring = await runStageChecks({ ...reel('vc_real'), voiceClone: async () => 'transfers' });
    expect(severityOf(transferring, 'media.voiceClone')).toBe('pass');
  });

  it('uses the system dry-run finding over the static declaration when one is present', async () => {
    const automation = input({
      listingKind: 'automation', objectKind: 'workflow',
      objects: [object('workflow', { steps: [{ kind: 'connector', action: 'sendSms' }] })],
    });

    const dryRun = await runStageChecks({
      ...automation,
      systemDryRun: async () => [{ code: 'system.outbound', group: 'runs', severity: 'block', label: '1 of 1 step(s) failed a stubbed dry run' }],
    });
    expect(severityOf(dryRun, 'system.outbound')).toBe('block');
    expect(isPublishable(dryRun)).toBe(false);

    const noProbe = await runStageChecks(automation);
    expect(severityOf(noProbe, 'system.outbound')).toBe('pass');
  });
});

describe('sells', () => {
  it('warns when a priced listing gives the whole thing away at the URL that sells it', async () => {
    const checks = await runStageChecks(input({
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
  it('sorts blockers first, so a refusal is never below four passes', async () => {
    const checks = await runStageChecks(input({
      listingKind: 'game',
      objectKind: 'game',
      objects: [object('game', { document: '<p>no script</p>' })],
    }));
    expect(checks[0]?.severity).toBe('block');
  });

  it('is pure — the same input twice gives the same findings', async () => {
    const build = () => runStageChecks(input({
      listingKind: 'book',
      objectKind: 'book',
      objects: [object('book', { pages: [{ page: '1', body: 'Text' }] })],
    }));
    expect(codes(await build())).toEqual(codes(await build()));
  });

  it('states the bound on Stage itself, on every listing, without refusing one', async () => {
    // The limit the wave parked deliberately: nothing here installs the snapshot into
    // a throwaway tenant and drives it. A platform limitation the platform knows about
    // is one the buyer is entitled to read, so it is a `warn` — carried onto the
    // listing by `declaredLimits` — and never a gate.
    const checks = await runStageChecks(input({
      listingKind: 'book',
      objectKind: 'book',
      objects: [object('book', { pages: [{ page: '1', body: 'Text' }], coverImageUrl: 'https://e.test/c.png' })],
    }));
    expect(severityOf(checks, STAGE_SANDBOX_LIMIT_CODE)).toBe('warn');
    expect(isPublishable(checks)).toBe(true);
    expect(codes(declaredLimits(checks))).toContain(STAGE_SANDBOX_LIMIT_CODE);
  });
});

/**
 * R8 — the harness that reads the ADDRESS.
 *
 * These are the assertions that make "an app whose address 404s is not sellable"
 * true rather than intended.
 */
describe('harness · deployment', () => {
  const hosted = (canvasData: Record<string, unknown>, probe?: StageInput['probe']) => input({
    listingKind: 'app',
    objectKind: 'website',
    delivery: 'hosted',
    objects: [object('website', { posterUrl: 'https://example.test/p.png', ...canvasData })],
    probe,
  });

  it('BLOCKS a hosted listing whose address does not serve — the R8 defect', async () => {
    const checks = await runStageChecks(hosted(
      { siteUrl: 'https://gone.example' },
      probing({ root: 'breach', health: 'unknown' }),
    ));
    expect(severityOf(checks, 'deployment.address')).toBe('block');
    expect(isPublishable(checks)).toBe(false);
  });

  it('BLOCKS a 2xx that is not the backend answering', async () => {
    // The whole reason a status code is not the assertion: a deleted function still
    // answers 200 from an edge, and only the engine emits its own marker.
    const checks = await runStageChecks(hosted(
      { siteUrl: 'https://parked.example' },
      probing({ root: 'ok', health: 'breach' }),
    ));
    expect(severityOf(checks, 'deployment.health')).toBe('block');
    expect(isPublishable(checks)).toBe(false);
  });

  it('passes a serving address, and DECLARES the absence of a readiness route', async () => {
    // A published static site legitimately has no generated backend. Refusing those
    // would refuse every site that works — so it is declared, not blocked.
    const checks = await runStageChecks(hosted(
      { siteUrl: 'https://live.example' },
      probing({ root: 'ok', health: 'unknown' }),
    ));
    expect(severityOf(checks, 'deployment.address')).toBe('pass');
    expect(severityOf(checks, 'deployment.health')).toBe('warn');
    expect(isPublishable(checks)).toBe(true);
    expect(codes(declaredLimits(checks))).toContain('deployment.health');
  });

  it('BLOCKS a hosted listing with no address at all', async () => {
    const checks = await runStageChecks(hosted({ title: 'My service' }, probing({})));
    expect(severityOf(checks, 'deployment.address')).toBe('block');
  });

  it('never silently passes when it could not ask, and never gates on that either', async () => {
    // The re-display path has no network. Inventing "healthy" would be the exact
    // failure this harness exists to prevent; inventing "broken" would leave a seller
    // staring at a blocker no fix can clear.
    const checks = await runStageChecks(hosted({ siteUrl: 'https://live.example' }, null));
    expect(severityOf(checks, 'deployment.address')).toBe('warn');
    expect(isPublishable(checks)).toBe(true);
  });

  it('does NOT reach the deployment harness for the same card sold as a copy', async () => {
    // Selling the BUILD of a website is a runtime question about the captured
    // document, and asking a live address about it would refuse a perfectly good sale.
    const checks = await runStageChecks(input({
      listingKind: 'app',
      objectKind: 'website',
      delivery: 'copy',
      objects: [object('website', { document: '<script>ontouchstart</script>' })],
    }));
    expect(codes(checks)).not.toContain('deployment.address');
    expect(severityOf(checks, 'runtime.document')).toBe('pass');
  });
});

/**
 * The entitlement rule, asserted where BOTH shop windows can see it break.
 *
 * A second copy of this derivation is the defect the named export exists to prevent,
 * so the precedence is pinned here rather than inside one caller's tests.
 */
describe('the entitlement rule', () => {
  it('lets a licence through a withdrawn listing, and nobody else', () => {
    const holder = resolveListingAccess({ priceCents: 900, visibility: 'private', hasLicence: true });
    expect(holder).toMatchObject({ visible: true, entitled: true, reason: 'licence' });

    const stranger = resolveListingAccess({ priceCents: 900, visibility: 'private', hasLicence: false });
    expect(stranger).toMatchObject({ visible: false, entitled: false, reason: 'withdrawn' });
  });

  it('withdraws a FREE listing too', () => {
    // Without withdrawn beating `open`, unpublishing would do nothing at all to
    // anything free — the storefront would close and the product would keep running.
    expect(resolveListingAccess({ priceCents: 0, visibility: 'private', hasLicence: false }).visible)
      .toBe(false);
  });

  it('gives a paid listing its preview, and only a deliberate trial the product', () => {
    expect(resolveListingAccess({ priceCents: 900, visibility: 'public', hasLicence: false }))
      .toMatchObject({ entitled: false, reason: 'preview' });
    expect(resolveListingAccess({ priceCents: 900, trial: 'full', visibility: 'public', hasLicence: false }))
      .toMatchObject({ entitled: true, reason: 'openTrial' });
    expect(resolveListingAccess({ priceCents: 0, visibility: 'public', hasLicence: false }))
      .toMatchObject({ entitled: true, reason: 'free' });
  });
});

/**
 * R9 — what a subscriber is owed when a hosted app goes dark.
 *
 * The windows are a PROMISE quoted before a sale, so they are pinned like any other
 * term of one.
 */
describe('the hosted lifecycle', () => {
  const at = (daysDark: number) => resolveHostedLifecycle({
    unreachableSinceISO: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    nowISO: new Date(Date.UTC(2026, 0, 1) + daysDark * 86_400_000).toISOString(),
  });

  it('is `operating` while the address answers, and charges for it', () => {
    expect(resolveHostedLifecycle({ unreachableSinceISO: null }))
      .toMatchObject({ state: 'operating', billable: true, subscriberMayTake: false });
  });

  it('keeps billing through the grace window — a four-minute deploy is not a refund', () => {
    expect(at(1)).toMatchObject({ state: 'grace', billable: true, subscriberMayExport: false });
    expect(at(13.9)).toMatchObject({ state: 'grace', billable: true });
  });

  it('stops billing and opens export when grace runs out', () => {
    expect(at(14)).toMatchObject({ state: 'readOnly', billable: false, subscriberMayExport: true, subscriberMayTake: false });
    expect(at(43)).toMatchObject({ state: 'readOnly', billable: false });
  });

  it('releases the build to every subscriber once it is abandoned', () => {
    expect(at(44)).toMatchObject({ state: 'released', billable: false, subscriberMayTake: true });
    expect(at(400)).toMatchObject({ state: 'released', subscriberMayTake: true });
  });

  it('counts down to the next transition, so the promise is legible before it lands', () => {
    expect(at(3).daysUntilNextState).toBe(11);
    expect(at(20).daysUntilNextState).toBe(24);
    expect(at(100).daysUntilNextState).toBeNull();
  });
});
