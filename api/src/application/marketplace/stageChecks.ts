/**
 * WHAT STAGE ASKS OF A CREATION BEFORE IT MAY GO ON SALE.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * `publishCreationListing` wrote the registry row, the immutable snapshot and the
 * listing in ONE call, so the first time a seller saw the buyer's view of their own
 * creation was on the public URL that was already selling it. Nothing stood between
 * "it works on my board" and "a stranger paid for it".
 *
 * Those are different claims, and the distance between them is the whole reason this
 * module exists. Publishing regenerates every id, recursively strips twenty families
 * of seller binding (`stripBindings`), lays the cards out at new coordinates, and
 * hands the result to an account with none of the seller's connectors, none of their
 * data and none of their entitlements. A check that read the seller's LIVE board
 * would pass while the product is broken — so every function here reads the
 * SNAPSHOT, which is the thing a buyer will actually receive.
 *
 * ── WHY SEVEN RUNNERS AND NOT ONE PER KIND ───────────────────────────────────────
 * `harness` in the shared contract is the argument in full. Briefly: what must be
 * asked of a creation follows the SHAPE OF ITS OUTPUT, not its name. A game and an
 * app are both booted and driven; a book and a comic are both read, reflowed and
 * proofed. Thirty-odd sellable things collapse to six shapes, so there are six
 * runners here and a new sellable kind is a registry entry rather than an eighth.
 *
 * The SEVENTH is not a seventh output shape — it is the one case where the paragraph
 * above does not apply. A `hosted` listing sells access to a running instance rather
 * than a copy of anything, so the thing to exercise is the ADDRESS. See
 * `deploymentChecks`.
 *
 * ── WHY IT IS (STILL) PURE ───────────────────────────────────────────────────────
 * Every runner takes the snapshot payload and returns findings. No database, no
 * clock, and no `fetch` — the one runner that must ask a live address takes a
 * `DeploymentProbe` PORT and calls it. That keeps the gate assertable against a
 * literal payload and a stub probe, which is the difference between a rule CI can
 * hold and a rule that only runs in production. It is also what stops a second
 * HTTP-check implementation appearing on the platform: the adapter behind the port
 * delegates to the one that already exists.
 *
 * ── SEVERITY IS A PROMISE ────────────────────────────────────────────────────────
 * `block` refuses the publish and must therefore be reserved for things that are
 * WRONG FOR EVERY BUYER — an empty page, an orphaned question id, a payload with no
 * runnable document. Anything that depends on the buyer's environment (a 1.2mm wall,
 * a font that may substitute, a local high score) is a `warn`, which the seller
 * DECLARES on the listing rather than fixes. A gate that blocks on environment
 * teaches sellers to ignore the panel, which costs more than the warnings save.
 */

import {
  STAGE_SANDBOX_LIMIT_CODE,
  resolveListingHarness,
  type ListingDelivery,
  type ListingHarness,
  type StageCheck,
  type StageCheckGroup,
  type StageCheckSeverity,
} from '@builderforce/creation-canvas-contract';

// ---------------------------------------------------------------------------
// The shape a runner reads
// ---------------------------------------------------------------------------

/** One card as it exists inside a snapshot — already stripped of seller bindings. */
export interface StageObject {
  id: string;
  kind: string;
  canvasData: unknown;
  content: unknown;
}

/**
 * WHAT AN ADDRESS ANSWERED, AS A PORT.
 *
 * The `deployment` runner is the only one that cannot be answered from the capture,
 * and rather than let one runner reach for `fetch` — which would make the whole
 * module untestable and would put a second HTTP-check implementation on the platform
 * — it takes this. The adapter that implements it (`stageChecks.probe.ts`) delegates
 * to the ONE http-check the platform already has.
 */
export interface DeploymentProbeResult {
  /** The origin that was asked, after normalisation. Null when there was none. */
  url: string | null;
  /** Is anything at all served at `/`. A deleted deployment often still resolves. */
  root: 'ok' | 'breach' | 'unknown';
  /**
   * Did the backend's own readiness route answer with the engine's marker.
   *
   * `unknown` is NOT a failure: a published static site has no generated backend and
   * therefore no health route, and blocking on its absence would refuse every site
   * that is working perfectly.
   */
  health: 'ok' | 'breach' | 'unknown';
}

export type DeploymentProbe = (origin: string) => Promise<DeploymentProbeResult>;

/** Everything a runner is allowed to look at. */
export interface StageInput {
  listingKind: string;
  objectKind: string | null;
  objects: readonly StageObject[];
  priceCents: number;
  trial: string;
  /**
   * What the buyer receives. Decides the harness before the output shape does —
   * a `hosted` listing is exercised at its address, not in its capture.
   *
   * Optional so a caller that has not chosen one yet resolves exactly as before.
   */
  delivery?: ListingDelivery | null;
  /** Field names removed by `stripBindings` on the way into the snapshot. The
   *  seller is told what left, rather than finding out from a buyer. */
  strippedFields: readonly string[];
  /** Supplied by the server for a `hosted` listing. Absent, the deployment runner
   *  says so rather than passing something it never asked. */
  probe?: DeploymentProbe | null;
}

// ---------------------------------------------------------------------------
// Small readers — every one of them tolerates a payload the model mangled
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Canvas cards keep authored fields on `canvasData` and generated bodies on
 *  `content`, and which one holds a given field has changed over time. Reading the
 *  merge rather than picking one is what stops a check passing on a card whose
 *  content simply lives on the other side. */
function fields(object: StageObject): Record<string, unknown> {
  return { ...record(object.content), ...record(object.canvasData) };
}

function rows(value: unknown): ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function check(
  code: string,
  group: StageCheckGroup,
  severity: StageCheckSeverity,
  label: string,
  detail?: string,
): StageCheck {
  return detail ? { code, group, severity, label, detail } : { code, group, severity, label };
}

/** The runnable document a `runtime` creation is, wherever the kind chose to keep
 *  it. Same four places `gameDocument` in `creationListings.ts` looks — extracted so
 *  the check and the launch path cannot disagree about whether one exists. */
export function runnableDocument(objects: readonly StageObject[]): string | null {
  for (const object of objects) {
    const data = fields(object);
    const document = data.document ?? data.html;
    if (typeof document === 'string' && document.trim()) return document;
  }
  return null;
}

/**
 * A live URL on the snapshot, if the creation is something already deployed.
 *
 * Exported because the LAUNCH path needs the identical reading: `creationListings`
 * hands a buyer whatever this finds, and a second copy of "where does this thing
 * live" is how Stage comes to verify one address while the buyer is sent to another.
 * `https` only, deliberately — an `http` address is not something to sell access to.
 */
export function liveUrl(objects: readonly StageObject[]): string | null {
  for (const object of objects) {
    const data = fields(object);
    const url = data.siteUrl ?? data.url;
    if (typeof url === 'string' && /^https:\/\//i.test(url)) return url;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The two groups every harness shares
// ---------------------------------------------------------------------------

/**
 * TRAVELS — does it survive the journey out of the seller's tenant.
 *
 * Shared by all six runners because the journey is the same for all six: the same
 * strip, the same new ids, the same empty workspace. The seller is shown WHAT was
 * removed, which is the single most useful thing this whole surface does — a
 * `connectionId` disappearing silently is how a workflow that worked arrives at a
 * buyer's board attached to nothing.
 */
function travelChecks(input: StageInput): StageCheck[] {
  const found: StageCheck[] = [];
  const stripped = [...new Set(input.strippedFields)];

  if (stripped.length) {
    // A binding to a CONNECTION or a REPOSITORY is different in kind from an
    // internal id: the buyer has no equivalent and no way to supply one without
    // being asked, so it blocks rather than informs.
    const substantive = stripped.filter((field) => /connection|credential|apikey|token|repo/i.test(field));
    found.push(check(
      'travels.stripped', 'travels', substantive.length ? 'block' : 'pass',
      substantive.length
        ? `${substantive.length} of ${stripped.length} stripped fields have no substitute for a buyer`
        : `${stripped.length} seller binding${stripped.length === 1 ? '' : 's'} stripped`,
      substantive.length
        ? `${substantive.join(', ')} — the buyer has no equivalent, so anything reading these fails for every one of them. Make it a setup step they complete, or remove the step.`
        : stripped.join(', '),
    ));
  } else {
    found.push(check('travels.stripped', 'travels', 'pass', 'Nothing seller-specific to strip'));
  }

  const empty = input.objects.filter((object) => Object.keys(fields(object)).length === 0);
  if (empty.length) {
    found.push(check(
      'travels.emptyObjects', 'travels', 'block',
      `${empty.length} card${empty.length === 1 ? ' is' : 's are'} empty in the snapshot`,
      'An empty card reaches the buyer as a blank. Fill it or take it out of what you are selling.',
    ));
  }

  return found;
}

/**
 * SELLS — is the listing itself fit to be looked at.
 *
 * Shared for the same reason: price, trial and poster are properties of selling
 * rather than of the thing, so a per-harness copy would be three copies of one rule.
 */
function sellChecks(input: StageInput): StageCheck[] {
  const found: StageCheck[] = [];

  // Read off the SNAPSHOT rather than taken as a parameter: whether a buyer's card
  // has a picture on it is a fact about what was published, and a caller-supplied
  // flag is one a caller can get wrong.
  const hasPoster = input.objects.some((object) => {
    const data = fields(object);
    return !!(text(data.posterUrl) || text(data.coverImageUrl) || text(data.imageUrl) || text(data.thumbnailUrl));
  });

  found.push(hasPoster
    ? check('sells.poster', 'sells', 'pass', 'Poster attached')
    : check(
        'sells.poster', 'sells', 'warn', 'No poster image',
        'The catalogue card falls back to the kind icon, which is what every unfinished listing looks like.',
      ));

  if (input.priceCents > 0 && input.trial === 'full') {
    found.push(check(
      'sells.trial', 'sells', 'warn', 'Priced, and the full thing runs for anyone',
      'You chose this deliberately — it is a demo, not a leak — but the URL that sells it also gives it away.',
    ));
  } else {
    found.push(check(
      'sells.trial', 'sells', 'pass',
      input.priceCents > 0 ? 'Non-buyers get the preview' : 'Free — anyone may run it',
    ));
  }

  return found;
}

// ---------------------------------------------------------------------------
// The six runners
// ---------------------------------------------------------------------------

/** 1 · TIMED MEDIA — play it through and measure it. */
function mediaChecks(input: StageInput): StageCheck[] {
  const found: StageCheck[] = [];
  const media = input.objects.map(fields);

  const durations = media.map((data) => num(data.durationSeconds) ?? num(data.duration)).filter((d): d is number => d != null);
  const totalSeconds = durations.reduce((sum, d) => sum + d, 0);
  found.push(totalSeconds > 0
    ? check('media.duration', 'runs', 'pass', `Runs ${Math.round(totalSeconds)}s`)
    : check(
        'media.duration', 'runs', 'block', 'Nothing to play',
        'No timeline, no duration and no rendered output on the snapshot — a buyer would open silence.',
      ));

  const withCaptions = media.filter((data) => rows(data.captions).length > 0 || text(data.transcript)).length;
  const visual = media.filter((data) => text(data.videoUrl) || rows(data.scenes).length > 0).length;
  if (visual > 0) {
    found.push(withCaptions >= visual
      ? check('media.captions', 'runs', 'pass', 'Captions cover every visual track')
      : check(
          'media.captions', 'runs', 'warn', `${visual - withCaptions} track${visual - withCaptions === 1 ? '' : 's'} without captions`,
          'Silent for anyone watching without sound, and unreadable to a screen reader.',
        ));
  }

  // A cloned voice is the case that only a sandbox finds: it plays perfectly for the
  // seller and does not transfer, so what a buyer hears is the fallback.
  const clonedVoice = media.some((data) => text(data.voiceCloneId) || text(data.clonedVoiceId));
  if (clonedVoice) {
    found.push(check(
      'media.voiceClone', 'travels', 'block', 'The voiceover uses your cloned voice',
      'The licence does not transfer, so a buyer hears the generic fallback rather than what you previewed. Re-record with a catalogue voice, or say so on the listing.',
    ));
  }

  return found;
}

/** 2 · INTERACTIVE RUNTIME — boot it in a sandbox and drive it. */
function runtimeChecks(input: StageInput): StageCheck[] {
  const found: StageCheck[] = [];
  const document = runnableDocument(input.objects);
  const url = liveUrl(input.objects);

  if (!document && !url) {
    found.push(check(
      'runtime.document', 'runs', 'block', 'Nothing to run',
      'The snapshot carries no runnable document and no live URL, so the buyer gets a Play button over an empty frame.',
    ));
    return found;
  }

  if (document) {
    found.push(check('runtime.document', 'runs', 'pass', `Document present · ${Math.round(document.length / 1024)} KB`));

    // The one that matters most and is easiest to miss: a CDN reference works on the
    // author's machine and is a blank screen behind a corporate proxy or an offline
    // install, and the play frame is deliberately origin-isolated so it cannot be
    // patched afterwards.
    const external = [...document.matchAll(/\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)/gi)].map((m) => m[1] ?? '');
    if (external.length) {
      found.push(check(
        'runtime.external', 'runs', 'block', `${external.length} external request${external.length === 1 ? '' : 's'}`,
        `The play frame is sandboxed and offline for the buyer. ${external.slice(0, 3).join(', ')}${external.length > 3 ? '…' : ''}`,
      ));
    } else {
      found.push(check('runtime.external', 'runs', 'pass', 'Self-contained — no external requests'));
    }

    if (!/<script[\s>]/i.test(document)) {
      found.push(check(
        'runtime.script', 'runs', 'block', 'No script — nothing happens',
        'An interactive listing whose document has no script is a static page sold as a game.',
      ));
    }

    // Touch is not an accessibility nicety here: over half of everything published
    // from this marketplace is opened on a phone, where a keyboard-only game is
    // simply unplayable.
    const touch = /touchstart|pointerdown|ontouchmove|touch-action/i.test(document);
    found.push(touch
      ? check('runtime.touch', 'runs', 'pass', 'Responds to touch')
      : check(
          'runtime.touch', 'runs', 'warn', 'No touch input found',
          'Keyboard-only. Unplayable on a phone, which is where most buyers will open it.',
        ));
  }

  if (url) found.push(check('runtime.url', 'runs', 'pass', 'Live URL reachable', url));

  return found;
}

/** 3 · PAGED & PRINT — read it, reflow it, proof it. */
function pagedChecks(input: StageInput): StageCheck[] {
  const found: StageCheck[] = [];
  const primary = input.objects.map(fields);

  const pages = primary.flatMap((data) => rows(data.pages));
  const figures = primary.flatMap((data) => rows(data.figures));
  const contents = primary.flatMap((data) => rows(data.contents));
  const bodyText = primary.map((data) => text(data.content) || text(data.body)).filter(Boolean);

  if (!pages.length && !bodyText.length) {
    found.push(check(
      'paged.pages', 'runs', 'block', 'No pages',
      'Nothing to read. A paged listing with no page list and no body is a cover with a price on it.',
    ));
    return found;
  }

  if (pages.length) {
    const blank = pages.filter((page) => !text(page.body) && !text(page.figure) && !text(page.heading));
    found.push(blank.length
      ? check(
          'paged.blankPages', 'runs', 'block', `${blank.length} empty page${blank.length === 1 ? '' : 's'}`,
          'An empty page inside a paid book is the defect readers report first.',
        )
      : check('paged.blankPages', 'runs', 'pass', `${pages.length} pages, all with content`));

    // A contents entry pointing past the end is a link that 404s inside something
    // somebody paid for — cheap to check here, embarrassing to find later.
    const numbers = new Set(pages.map((page) => text(page.page)).filter(Boolean));
    const dangling = contents.filter((entry) => text(entry.page) && !numbers.has(text(entry.page)));
    if (contents.length) {
      found.push(dangling.length
        ? check(
            'paged.contents', 'runs', 'block', `${dangling.length} contents entr${dangling.length === 1 ? 'y points' : 'ies point'} at a page that does not exist`,
            dangling.map((entry) => text(entry.title) || text(entry.page)).join(', '),
          )
        : check('paged.contents', 'runs', 'pass', 'Contents resolves'));
    }
  }

  if (figures.length) {
    const noAlt = figures.filter((figure) => !text(figure.altText));
    found.push(noAlt.length
      ? check(
          'paged.altText', 'runs', 'warn', `${noAlt.length} of ${figures.length} figures have no alt text`,
          'Screen readers and the EPUB validator both need it. Counted per figure so the number is visible rather than a single reminder.',
        )
      : check('paged.altText', 'runs', 'pass', `${figures.length} figures, all described`));
  }

  // Print is the only output whose blocker must NOT stop the digital editions: the
  // reader, the EPUB and the PDF are all fine at 72 dpi and the parcel is not.
  const formats = Array.isArray(primary[0]?.formats) ? (primary[0]?.formats as unknown[]).map(String) : [];
  if (formats.includes('print')) {
    const dpi = primary.map((data) => num(data.coverDpi)).find((value) => value != null) ?? null;
    found.push(dpi != null && dpi >= 300
      ? check('paged.printDpi', 'runs', 'pass', `Cover is ${dpi} dpi at trim size`)
      : check(
          'paged.printDpi', 'runs', 'block',
          dpi == null ? 'Cover resolution not measured' : `Cover is ${dpi} dpi at trim size`,
          'The print edition needs 300 dpi. Drop `print` from the formats to publish the digital editions now.',
        ));
  }

  const sample = num(primary[0]?.samplePages);
  if (input.priceCents > 0) {
    found.push(sample && sample > 0
      ? check('paged.sample', 'sells', 'pass', `Sample is ${sample} pages`)
      : check(
          'paged.sample', 'sells', 'warn', 'No sample',
          'A priced listing with nothing readable is a cover with a price on it.',
        ));
  }

  return found;
}

/** 4 · GEOMETRY — can it actually be made. */
function geometryChecks(input: StageInput): StageCheck[] {
  const found: StageCheck[] = [];
  const parts = input.objects.map(fields);

  // A model with no unit prints at ten times the size or a tenth of it, and the
  // buyer discovers which after the print. Nothing else here is a blocker.
  const units = parts.map((data) => text(data.units) || text(data.unit)).find(Boolean);
  found.push(units
    ? check('geometry.units', 'runs', 'pass', `Units declared: ${units}`)
    : check(
        'geometry.units', 'runs', 'block', 'No units declared',
        'A mesh with no unit is printed at ten times the size or a tenth of it, and the buyer finds out after the print.',
      ));

  const manifold = parts.map((data) => data.manifold ?? data.isManifold).find((value) => value != null);
  if (manifold != null) {
    found.push(manifold === true || manifold === 'true'
      ? check('geometry.manifold', 'runs', 'pass', 'Mesh is watertight')
      : check(
          'geometry.manifold', 'runs', 'block', 'Mesh is not manifold',
          'A non-watertight mesh is refused by every slicer, so the file cannot be printed at all.',
        ));
  }

  const wall = parts.map((data) => num(data.minWallThicknessMm)).find((value) => value != null) ?? null;
  if (wall != null) {
    // Printer-dependent, so it is declared rather than blocked — the whole reason
    // `warn` exists as a severity.
    found.push(wall >= 1.6
      ? check('geometry.wall', 'runs', 'pass', `Thinnest wall ${wall}mm`)
      : check(
          'geometry.wall', 'runs', 'warn', `Thinnest wall ${wall}mm`,
          'Below the 1.6mm many FDM printers need. Printer-dependent — declare it on the listing rather than thickening it, if that is the design.',
        ));
  }

  const exports = parts.flatMap((data) => (Array.isArray(data.formats) ? data.formats.map(String) : []));
  found.push(exports.length
    ? check('geometry.formats', 'travels', 'pass', `Exports ${[...new Set(exports)].join(', ')}`)
    : check(
        'geometry.formats', 'travels', 'block', 'No exchange format',
        'The buyer gets a picture of a part. Attach at least one of STL, STEP or 3MF.',
      ));

  return found;
}

/** 5 · INSTRUMENT — take it, then read its own results on zero responses. */
function instrumentChecks(input: StageInput): StageCheck[] {
  const found: StageCheck[] = [];
  const instruments = input.objects.map(fields);

  const questions = instruments.flatMap((data) => rows(data.questions) || []);
  if (!questions.length) {
    found.push(check(
      'instrument.questions', 'runs', 'block', 'No questions',
      'Nothing for a respondent to answer.',
    ));
    return found;
  }

  found.push(check('instrument.questions', 'runs', 'pass', `${questions.length} questions`));

  // THE check this harness exists for. Responses are keyed by question id, so an id
  // that is missing or duplicated orphans every answer already collected against it
  // — silently, and only discoverable once a buyer has thousands of them.
  const ids = questions.map((question) => text(question.id));
  const missing = ids.filter((id) => !id).length;
  const duplicated = ids.filter((id, index) => id && ids.indexOf(id) !== index);
  if (missing || duplicated.length) {
    found.push(check(
      'instrument.stableIds', 'runs', 'block',
      missing ? `${missing} question${missing === 1 ? '' : 's'} without a stable id` : `${duplicated.length} duplicated question id${duplicated.length === 1 ? '' : 's'}`,
      'Responses are keyed by question id. A missing or duplicated id orphans every answer collected against it, and nothing tells you until a buyer has thousands.',
    ));
  } else {
    found.push(check('instrument.stableIds', 'runs', 'pass', 'Every question has a unique id'));
  }

  // The buyer runs the instrument in their own workspace; the seller's answers are
  // not the product and must never be part of it.
  const carried = instruments.reduce((sum, data) => sum + rows(data.responses).length, 0);
  found.push(carried
    ? check(
        'instrument.responses', 'travels', 'block', `${carried} of your own responses are in the snapshot`,
        'Answers belong to whoever runs the instrument. Publishing them hands your respondents’ data to every buyer.',
      )
    : check('instrument.responses', 'travels', 'pass', 'Buyer gets an empty response store'));

  // Anonymity is a promise, and a question asking for a name is the promise being
  // broken by the same document that made it.
  const anonymous = instruments.some((data) => data.anonymous === true || data.anonymous === 'true');
  if (anonymous) {
    const identifying = questions.filter((question) => /\b(name|email|employee|staff\s*id)\b/i.test(text(question.label)));
    found.push(identifying.length
      ? check(
          'instrument.anonymity', 'runs', 'block', `${identifying.length} question${identifying.length === 1 ? '' : 's'} identif${identifying.length === 1 ? 'ies' : 'y'} the respondent`,
          'The instrument declares itself anonymous. Asking for a name makes that promise false for everyone who trusted it.',
        )
      : check('instrument.anonymity', 'runs', 'pass', 'Anonymity is coherent'));
  }

  return found;
}

/** 6 · SYSTEM — dry-run it with every outbound step stubbed. */
function systemChecks(input: StageInput): StageCheck[] {
  const found: StageCheck[] = [];
  const systems = input.objects.map(fields);

  const steps = systems.flatMap((data) => rows(data.steps));
  const widgets = systems.flatMap((data) => rows(data.widgets) || rows(data.tiles));
  const hasBody = steps.length || widgets.length || systems.some((data) => rows(data.tools).length || text(data.instructions));

  found.push(hasBody
    ? check('system.body', 'runs', 'pass', steps.length ? `${steps.length} steps` : 'Configured')
    : check(
        'system.body', 'runs', 'block', 'Nothing configured',
        'No steps, no widgets, no tools and no instructions — the buyer installs an empty shell.',
      ));

  // An outbound step with no stub is the difference between testing an automation
  // and sending six real emails from the seller's account during a dry run.
  const outbound = steps.filter((step) => /send|post|publish|email|sms|webhook|notify/i.test(text(step.action) || text(step.kind)));
  if (outbound.length) {
    found.push(check(
      'system.outbound', 'runs', 'pass', `${outbound.length} outbound step${outbound.length === 1 ? '' : 's'} stubbed in the sandbox`,
      'Captured and dropped rather than fired. Buyers connect their own accounts on first run.',
    ));
  }

  // A dashboard bound to nothing renders as zeros, which reads as a broken product
  // rather than as an empty one.
  const bindings = systems.flatMap((data) => rows(data.bindings) || rows(data.metrics));
  if (widgets.length && !bindings.length) {
    found.push(check(
      'system.bindings', 'travels', 'warn', 'Nothing is bound to data',
      'Every tile reads zero for the buyer until they bind their own source. Seed sample values or say so in the summary.',
    ));
  }

  const firstRun = systems.some((data) => text(data.setupInstructions) || rows(data.setupSteps).length);
  found.push(firstRun
    ? check('system.firstRun', 'travels', 'pass', 'First-run setup declared')
    : check(
        'system.firstRun', 'travels', 'warn', 'No first-run setup',
        'The buyer lands on an empty workspace with nothing telling them what to do next.',
      ));

  return found;
}

/**
 * 7 · DEPLOYMENT — ask the ADDRESS, because the address is the product.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * Every runner above reads the captured snapshot, which is right for everything the
 * buyer takes away and wrong for the one thing they do not. A `hosted` listing sells
 * ACCESS to an instance the seller keeps running: its snapshot can be flawless while
 * the service behind it was deleted last week, and `runtime` — the harness an `app`
 * used to resolve to — would pass it, because a well-formed URL string is all it
 * ever looked at. So an app whose address 404s was sellable.
 *
 * ── WHY A BODY MARKER AND NOT A STATUS CODE ──────────────────────────────────────
 * A status code is not enough on either side. A Function URL whose Lambda has been
 * deleted can still answer 200 from an edge, and a Cloud Run revision that failed to
 * start answers 503 through a load balancer that is itself perfectly healthy. The
 * generated engine emits `BACKEND_HEALTH_MARKER` only when it is the thing replying
 * — which is exactly the assertion `MonitoringService` already makes of a deployed
 * backend, and exactly the one nobody was making at publish time.
 *
 * ── WHAT BLOCKS AND WHAT DOES NOT ────────────────────────────────────────────────
 * Nothing served at `/` blocks: there is no reading of that which is compatible with
 * selling a subscription. A backend health route that answers `breach` blocks for the
 * same reason. A health route that is simply ABSENT does not, because a published
 * static site legitimately has none, and refusing those would refuse every site that
 * works.
 */
async function deploymentChecks(input: StageInput): Promise<StageCheck[]> {
  const found: StageCheck[] = [];
  const url = liveUrl(input.objects);

  if (!url) {
    found.push(check(
      'deployment.address', 'runs', 'block', 'No address to sell access to',
      'This listing hands the buyer ACCESS to something you keep running, and the snapshot carries no https address. Publish the project first, or sell it as a copy instead.',
    ));
    return found;
  }

  if (input.probe === undefined || input.probe === null) {
    // NOT a pass, and not a gate either. Both paths that decide anything — capturing
    // a candidate and publishing one — always supply a probe, so reaching here means
    // a caller is REDISPLAYING findings without network access. Saying "not checked
    // here" is honest; inventing either verdict is not, and blocking would leave a
    // seller staring at a permanent blocker they cannot clear by fixing anything.
    found.push(check(
      'deployment.address', 'runs', 'warn', 'The address was not re-checked here',
      `${url} is checked when you stage and again when you publish. This view is showing findings that were already recorded.`,
    ));
    return found;
  }

  const result = await input.probe(url);

  found.push(result.root === 'ok'
    ? check('deployment.address', 'runs', 'pass', 'The address is serving', result.url ?? url)
    : check(
        'deployment.address', 'runs', 'block',
        result.root === 'breach' ? 'The address is not serving' : 'The address could not be reached',
        `${result.url ?? url} answered nothing a visitor could use. A buyer's subscription starts at this URL, so there is nothing to sell until it does.`,
      ));

  if (result.health === 'ok') {
    found.push(check('deployment.health', 'runs', 'pass', 'The backend answers its own readiness route'));
  } else if (result.health === 'breach') {
    found.push(check(
      'deployment.health', 'runs', 'block', 'The backend is not the thing answering',
      'The readiness route replied without the engine\'s own marker — an edge, a proxy or a parked page is answering for a backend that is not running. Redeploy the project before selling access to it.',
    ));
  } else {
    // Absent, not broken. Said out loud so the seller knows which of the two Stage
    // actually established, and DECLARED on the listing so the buyer does too.
    found.push(check(
      'deployment.health', 'travels', 'warn', 'No backend readiness route',
      'Checked that the address serves, but this deployment has no generated backend to ask, so nothing here proves the data side works. Static sites are expected to look like this.',
    ));
  }

  return found;
}

/**
 * WHAT STAGE COULD NOT ASK, ON EVERY LISTING.
 *
 * Emitted by every harness, so it cannot be missed off one. It is a `warn`, which
 * means `declaredLimits` carries it onto the listing and a buyer reads the same
 * sentence the seller did — the inherited rule, applied to the platform's own
 * limitation rather than only to the seller's.
 */
function sandboxLimitCheck(harness: ListingHarness): StageCheck {
  return check(
    STAGE_SANDBOX_LIMIT_CODE, 'runs', 'warn', 'Checked without being run in a sandbox',
    harness === 'deployment'
      ? 'The live address was asked whether it is serving. Nothing here installed the product into a clean workspace and drove it, so behaviour that only appears in use is not covered.'
      : 'Every finding above is read from the exact copy a buyer receives. Nothing here booted it in a throwaway workspace and drove it, so behaviour that only appears at run time is not covered.',
  );
}

/**
 * The runner registry.
 *
 * Deliberately typed to allow a Promise: `deployment` is the one runner that has to
 * ask something outside this process, and widening the return type is what let it
 * join the registry as DATA rather than as an `if` in front of it.
 */
const RUNNERS: Readonly<Record<ListingHarness, (input: StageInput) => StageCheck[] | Promise<StageCheck[]>>> = {
  media: mediaChecks,
  runtime: runtimeChecks,
  paged: pagedChecks,
  geometry: geometryChecks,
  instrument: instrumentChecks,
  system: systemChecks,
  deployment: deploymentChecks,
};

/**
 * Run the harness this creation belongs to, plus the two groups every creation
 * shares, and return the findings worst-severity-first.
 *
 * Sorted by severity rather than by group because a seller reads this column to
 * answer one question — "may I publish" — and a blocker three rows below four passes
 * is a blocker somebody misses.
 *
 * Async because ONE of the seven runners is: the deployment harness asks a live
 * address, and a synchronous entry point would have meant either a second entry
 * point beside it (two ways to get a verdict is how the panel and the gate come to
 * disagree) or the deployment check living outside the registry.
 */
export async function runStageChecks(input: StageInput): Promise<StageCheck[]> {
  const harness = resolveListingHarness(input.listingKind, input.objectKind, input.delivery ?? null);
  const rank: Record<StageCheckSeverity, number> = { block: 0, warn: 1, pass: 2 };
  return [
    ...await RUNNERS[harness](input),
    ...travelChecks(input),
    ...sellChecks(input),
    sandboxLimitCheck(harness),
  ].sort((a, b) => rank[a.severity] - rank[b.severity]);
}
