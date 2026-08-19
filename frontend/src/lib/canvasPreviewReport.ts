/**
 * What a PREVIEWED page is allowed to say about itself, and how it says it.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * A framed page is opaque by construction. The canvas frames documents WITHOUT
 * `allow-same-origin` (a generated app, a game, a site) or with the page's OWN origin
 * (a live `browser` / `service` / `url` card) — and in both cases the parent document
 * cannot read a single thing inside: no `contentWindow.console`, no `PerformanceObserver`
 * entries, no error events. That is the browser's security model working, not a bug.
 *
 * The consequence was that a preview which THREW looked exactly like a preview that
 * worked. The `app` surface already solved it for documents the canvas itself writes, by
 * injecting a reporter that posts back over `postMessage` — the one channel that needs no
 * same-origin. Everything else on the board was still silent, so this module lifts that
 * reporter out of `canvasApp.ts` and makes it THE contract:
 *
 *   · {@link CANVAS_PREVIEW_REPORTER} is injected into every document the canvas
 *     generates — the page cooperates because we wrote it.
 *   · A page we did NOT write cooperates by carrying `@seanhogg/builderforce-quality`,
 *     which posts the same messages (`browser-sdk/src/canvasPreview.ts`).
 *   · A page that carries neither reports nothing, and the panel says so in words rather
 *     than showing a clean console it never actually read.
 *
 * ── WHY THE WIRE SHAPE IS DECLARED HERE AND NOT AT EACH FRAME ────────────────────
 * Three senders (the injected script, the published SDK, and any future runner) and two
 * readers (the app surface, the web-page panel) have to agree on one tag and one entry
 * shape. Declaring it per call site is how the app surface ended up with a listener that
 * accepted messages from EVERY frame on the board, its own or not.
 */

/**
 * The tag every preview message carries.
 *
 * A framed document has an opaque or foreign origin, so the reader cannot authenticate
 * the sender by origin — it matches on this tag AND on `event.source` being its own
 * frame's `contentWindow` (see `useCanvasPreviewLog`). Neither check alone is enough: the
 * tag alone accepts a sibling card's frame, and the source alone accepts whatever
 * unrelated `postMessage` protocol the page under test already speaks.
 */
export const CANVAS_PREVIEW_MESSAGE = 'builderforce:canvas-preview';

export type CanvasPreviewLevel = 'log' | 'warn' | 'error' | 'request';

export interface CanvasPreviewEntry {
  level: CanvasPreviewLevel;
  text: string;
  /** Milliseconds since the frame booted, so a console reads as a run and not a clock. */
  at: number;
}

/** How many lines a reader keeps. A runaway `console.log` in a render loop must not grow
 *  the array without bound while the user watches the frame. */
export const CANVAS_PREVIEW_LOG_LIMIT = 200;

/** How many lines are written BACK onto the object for Brain to read. An order of
 *  magnitude below the live console on purpose: the snapshot is the model's context
 *  budget, and what it needs is the failure, not the run. */
export const CANVAS_PREVIEW_REPORT_LIMIT = 12;

/** Longest single message kept. Matches the cap the reporter applies at the sending end,
 *  so a reader fed by something else still cannot be flooded by one line. */
const MAX_TEXT = 500;

const LEVELS: ReadonlySet<string> = new Set<CanvasPreviewLevel>(['log', 'warn', 'error', 'request']);

/**
 * One entry from a `message` payload, or null when the payload is not ours.
 *
 * Every field is re-validated rather than trusted: the sender is a page under test, which
 * is by definition the code least likely to be correct, and on a `browser` card it is a
 * third-party site nobody on this board wrote.
 */
export function canvasPreviewEntry(payload: unknown): CanvasPreviewEntry | null {
  if (!payload || typeof payload !== 'object') return null;
  const message = payload as { tag?: unknown; level?: unknown; text?: unknown; at?: unknown };
  if (message.tag !== CANVAS_PREVIEW_MESSAGE) return null;
  if (typeof message.level !== 'string' || !LEVELS.has(message.level)) return null;
  const at = typeof message.at === 'number' && Number.isFinite(message.at) ? Math.max(0, Math.round(message.at)) : 0;
  return {
    level: message.level as CanvasPreviewLevel,
    text: typeof message.text === 'string' ? message.text.slice(0, MAX_TEXT) : '',
    at,
  };
}

/** Append within the live console's budget. */
export function appendCanvasPreviewEntry(
  log: readonly CanvasPreviewEntry[],
  entry: CanvasPreviewEntry,
): CanvasPreviewEntry[] {
  return [...log, entry].slice(-CANVAS_PREVIEW_LOG_LIMIT);
}

export interface CanvasPreviewSummary {
  errors: number;
  warnings: number;
  /** Calls the page made — the half a static audit of its HTML can never see. */
  requests: number;
  /** True once the frame has said ANYTHING. A page that never reports is a page whose
   *  console is unknown, which is a different statement from "no errors" and the whole
   *  reason this flag exists rather than being inferred from `errors === 0`. */
  reported: boolean;
}

export function canvasPreviewSummary(log: readonly CanvasPreviewEntry[]): CanvasPreviewSummary {
  let errors = 0, warnings = 0, requests = 0;
  for (const entry of log) {
    if (entry.level === 'error') errors += 1;
    else if (entry.level === 'warn') warnings += 1;
    else if (entry.level === 'request') requests += 1;
  }
  return { errors, warnings, requests, reported: log.length > 0 };
}

/**
 * The lines worth persisting onto the object.
 *
 * Errors and warnings first and in full, then whatever room is left goes to the tail of
 * the run. A report truncated by TIME would drop the throw that happened on load and keep
 * the request chatter that followed it, which is precisely backwards.
 */
export function canvasPreviewReportLog(log: readonly CanvasPreviewEntry[]): CanvasPreviewEntry[] {
  const failures = log.filter((entry) => entry.level === 'error' || entry.level === 'warn');
  if (failures.length >= CANVAS_PREVIEW_REPORT_LIMIT) return failures.slice(-CANVAS_PREVIEW_REPORT_LIMIT);
  const rest = log.filter((entry) => entry.level !== 'error' && entry.level !== 'warn');
  return [...failures, ...rest.slice(-(CANVAS_PREVIEW_REPORT_LIMIT - failures.length))]
    .sort((a, b) => a.at - b.at);
}

/**
 * Whether an HTTP status means the page a reader is looking at is not the page they asked
 * for. A `4xx`/`5xx` body renders perfectly well — a styled 404 is still a 404 — which is
 * exactly why a frame alone cannot tell anybody the request failed.
 */
export function canvasPreviewStatusFailed(status: unknown): boolean {
  return typeof status === 'number' && Number.isFinite(status) && status >= 400;
}

/**
 * The reporter injected into documents the canvas GENERATES, first in the document so it
 * patches before any authored code runs.
 *
 * It patches the three things a preview has to be honest about:
 *
 *   - `console.*`, because a page failing silently inside an opaque-origin frame is a
 *     page nobody can debug from outside it;
 *   - `error` / `unhandledrejection`, listened for in the CAPTURE phase, because a
 *     subresource that 404s does not bubble to `window` and so is missed by a plain
 *     listener — the same trap `EMBED_ERROR_REPORTER` documents;
 *   - `fetch`, because the front end will call a backend the frame does not have, and the
 *     browser's own "Failed to fetch" is indistinguishable from a bad credential.
 *
 * It reports through `postMessage` — the one channel that needs no same-origin, which is
 * the whole point of the sandbox — and it re-throws nothing it did not already throw.
 *
 * A raw string, not compiled code, because it has to be inlined into a `srcDoc` document
 * that has no module loader and no build step; the tag and the length cap are
 * interpolated from the constants above so the two halves cannot drift.
 */
export const CANVAS_PREVIEW_REPORTER = [
  '<script>(function(){',
  `  var TAG=${JSON.stringify(CANVAS_PREVIEW_MESSAGE)},t0=Date.now();`,
  `  function say(level,text){try{parent.postMessage({tag:TAG,level:level,text:String(text).slice(0,${MAX_TEXT}),at:Date.now()-t0},'*');}catch(e){}}`,
  "  ['log','warn','error'].forEach(function(level){",
  '    var original=console[level];',
  '    console[level]=function(){try{say(level,Array.prototype.map.call(arguments,function(v){',
  '      return typeof v===\'string\'?v:(function(){try{return JSON.stringify(v);}catch(e){return String(v);}})();',
  '    }).join(\' \'));}catch(e){}return original.apply(console,arguments);};',
  '  });',
  "  window.addEventListener('error',function(e){",
  '    var target=e&&e.target;',
  "    if(target&&target!==window&&(target.src||target.href))say('error','failed to load '+(target.src||target.href));",
  "    else say('error',(e&&e.message)||'script error');",
  '  },true);',
  "  window.addEventListener('unhandledrejection',function(e){say('error','Unhandled rejection: '+(e.reason&&e.reason.message||e.reason));});",
  '  var nativeFetch=window.fetch;',
  '  window.fetch=function(input,init){',
  "    var url=typeof input==='string'?input:(input&&input.url)||'';",
  "    var method=(init&&init.method)||(input&&input.method)||'GET';",
  "    say('request',method.toUpperCase()+' '+url);",
  '    return nativeFetch.apply(window,arguments).then(function(response){',
  "      if(response&&response.status>=400)say('error',method.toUpperCase()+' '+url+' — '+response.status);",
  '      return response;',
  '    },function(error){',
  "      say('error',method.toUpperCase()+' '+url+' — no host is attached to this preview');",
  '      throw error;',
  '    });',
  '  };',
  '})();</script>',
].join('\n');
