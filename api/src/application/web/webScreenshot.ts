/**
 * Server-side SCREENSHOT of a live page — the "before" half of a redesign.
 *
 * ── THE DEFECT THIS EXISTS TO END ────────────────────────────────────────────
 * Measured on the Creation Canvas 2026-08-19 (ui 2026.8.60 / api 2026.8.26): a user
 * asked to "upgrade my website https://… and improve the design. Show me a before and
 * after". Brain read the page with `builtin_web_fetch`, authored a genuinely good
 * redesign as a `website` object — and when asked where the "before" was, replied
 *
 *   "As a large language model, I don't have the ability to browse the web visually
 *    or take screenshots of live websites."
 *
 * which is a statement about a MODEL, offered as a statement about the PRODUCT. The
 * product renders framed documents at real device widths on that very canvas; the only
 * thing genuinely missing was pixels of somebody else's page, and nothing in the
 * platform could produce them. The model had no tool, so it improvised a limitation —
 * the same failure mode `canvas_add_image` and `canvas_add_game` were built to stop.
 *
 * This module is the capability that makes the honest answer possible. `webFetch.ts`
 * beside it reads what a page SAYS; this reads what a page LOOKS LIKE, and a redesign
 * conversation needs both.
 *
 * ── WHY A REMOTE BROWSER AND NOT A FRAME ─────────────────────────────────────
 * The canvas already frames live URLs, so "just iframe the old site" looks like the
 * cheap answer. It is not an answer at all: most real sites refuse third-party framing
 * (`X-Frame-Options` / `frame-ancestors` — `webFetch` reports exactly that as
 * `frameable`), a frame is not an image so it cannot sit beside the redesign in an
 * export, a print document or a marketplace listing, and a frame is live — reopen the
 * board next month and the "before" has quietly become the "after". A capture is a
 * dated artefact, which is the only thing a comparison can be built on.
 *
 * ── PROVIDER ─────────────────────────────────────────────────────────────────
 * Cloudflare Browser Rendering's REST endpoint, on the account this Worker already
 * holds credentials for. It is a real Chromium, so a JS-rendered marketing site
 * captures as its visitors see it rather than as its HTML source reads.
 *
 * Unconfigured is a first-class outcome, not a crash: {@link ScreenshotUnavailableError}
 * carries a reason the caller relays verbatim, because the whole point of this module
 * is that the user hears the TRUE reason instead of an invented one.
 */
import {
  CANVAS_VIEWPORTS,
  CANVAS_VIEWPORT_CAPTURE_HEIGHTS,
  CANVAS_VIEWPORT_WIDTHS,
  type CanvasViewport,
} from '@builderforce/creation-canvas-contract';
import { assertSafeUrl, resolveAndAssertPublic } from '../../infrastructure/net/ssrfGuard';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

/**
 * The viewport a capture is taken at.
 *
 * Composed from the SHARED canvas vocabulary rather than restated: a "before" shot taken
 * at one desktop width and framed beside an "after" drawn at another is a comparison of
 * two layouts presented as one. See `viewport.ts` in the canvas contract for why those
 * numbers moved out of the frontend when this module was written.
 */
export type ScreenshotViewport = CanvasViewport;

export function screenshotViewportSize(viewport: ScreenshotViewport): { width: number; height: number } {
  return { width: CANVAS_VIEWPORT_WIDTHS[viewport], height: CANVAS_VIEWPORT_CAPTURE_HEIGHTS[viewport] };
}

export function isScreenshotViewport(value: unknown): value is ScreenshotViewport {
  return typeof value === 'string' && (CANVAS_VIEWPORTS as readonly string[]).includes(value);
}

export interface WebScreenshotOptions {
  viewport?: ScreenshotViewport;
  /** Capture the whole scrollable page rather than the first screen. */
  fullPage?: boolean;
}

export interface WebScreenshotResult {
  /** The URL the caller asked for, after normalisation. */
  url: string;
  /** `data:image/jpeg;base64,…` — self-contained, so a capture survives on a local or
   *  guest board that has no tenant storage behind it, exactly like a generated image. */
  imageDataUrl: string;
  mimeType: string;
  /** The viewport the page was laid out at — NOT the pixel height of the result, which
   *  a full-page capture makes taller. Consumers frame by the layout width. */
  width: number;
  height: number;
  viewport: ScreenshotViewport;
  fullPage: boolean;
  /** Bytes of the encoded image, before base64. Reported so a caller can say why a
   *  capture was refused rather than silently truncating it. */
  byteSize: number;
  provider: 'cloudflare-browser-rendering';
  /** When these pixels were taken. A "before" without a date is not evidence. */
  capturedAt: string;
}

/**
 * Why a capture could not be taken, in words the model is instructed to relay.
 *
 * `unconfigured` is an OPERATOR fact (no browser-rendering credentials on this
 * deployment) and `provider` is a RUNTIME fact (the page timed out, refused, or the
 * renderer errored). They read differently to a user and only one of them is worth
 * retrying, so they are different reasons rather than one generic failure.
 */
export type ScreenshotUnavailableReason = 'unconfigured' | 'provider' | 'too-large';

export class ScreenshotUnavailableError extends Error {
  readonly reason: ScreenshotUnavailableReason;
  constructor(reason: ScreenshotUnavailableReason, message: string) {
    super(message);
    this.name = 'ScreenshotUnavailableError';
    this.reason = reason;
  }
}

/** Abort a renderer that is waiting on a slow origin. Browser rendering is genuinely
 *  slower than a fetch — a real Chromium loads the page — so this is not `webFetch`'s
 *  15s. */
const RENDER_TIMEOUT_MS = 45_000;

/** Hard cap on the encoded image. A capture is inlined into the canvas document as a
 *  data URL, so an unbounded one would bloat every future save of that board. JPEG at
 *  quality 78 puts a desktop screen at ~150–400KB; 4MB is a wide ceiling that still
 *  refuses a pathological full-page capture rather than persisting it. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** A capture is expensive (a real browser) and a page's appearance changes on the scale
 *  of days, not seconds. Six hours means a comparison re-opened during a working session
 *  costs one render, not one per turn. */
const SHOT_CACHE_KV_TTL_SECONDS = 6 * 60 * 60;
const SHOT_CACHE_L1_TTL_MS = 10 * 60 * 1000;

/**
 * Credentials for the renderer.
 *
 * Browser Rendering is a separate scope from Workers AI, so a deployment may hold one
 * and not the other — hence its own secret, falling back to the AI token because a
 * single account-wide token with both scopes is the common setup and requiring two
 * copies of the same string would be a configuration trap.
 */
function renderCredentials(env: Env | undefined): { accountId: string; token: string } {
  const accountId = env?.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = (env?.CLOUDFLARE_BROWSER_API_TOKEN ?? env?.CLOUDFLARE_AI_API_TOKEN)?.trim();
  if (!accountId || !token) {
    throw new ScreenshotUnavailableError(
      'unconfigured',
      'Live page capture is not configured on this deployment: it needs CLOUDFLARE_ACCOUNT_ID and a Browser Rendering token (CLOUDFLARE_BROWSER_API_TOKEN).',
    );
  }
  return { accountId, token };
}

/** Base64 without blowing the stack on a multi-hundred-KB image. */
export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

/**
 * Read the renderer's refusal as a sentence.
 *
 * Cloudflare answers a failure with `{ success: false, errors: [{ code, message }] }`,
 * and the message is the only thing that distinguishes "that page timed out" from "this
 * token has no Browser Rendering scope". Relaying it is the entire contract of this
 * module — a generic "screenshot failed" is how the model ends up guessing again.
 */
export async function readProviderError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ message?: unknown }> };
    const messages = (parsed.errors ?? [])
      .map((error) => (typeof error?.message === 'string' ? error.message.trim() : ''))
      .filter(Boolean);
    if (messages.length) return messages.join('; ');
  } catch { /* Not JSON — fall through to the raw body below. */ }
  return body.trim().slice(0, 400) || `The page renderer returned HTTP ${response.status}`;
}

/**
 * Capture one live page. Throws {@link ScreenshotUnavailableError} with a relayable
 * reason; never returns a placeholder, because a placeholder presented as a "before"
 * is worse than no comparison at all.
 */
export async function captureWebScreenshot(
  env: Env | undefined,
  rawUrl: string,
  options: WebScreenshotOptions = {},
): Promise<WebScreenshotResult> {
  const viewport = isScreenshotViewport(options.viewport) ? options.viewport : 'desktop';
  const fullPage = options.fullPage === true;
  const size = screenshotViewportSize(viewport);

  // `allowHttp` for the same reason `webFetch` does: people paste the address they
  // have, and a small business's current site is exactly the kind that is still on
  // plain http. The host checks below are what actually matter.
  const target = assertSafeUrl(rawUrl.trim(), { allowHttp: true });
  await resolveAndAssertPublic(target.hostname);

  const { accountId, token } = renderCredentials(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/screenshot`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          url: target.toString(),
          viewport: { width: size.width, height: size.height },
          // `networkidle0` is what makes a JS-rendered marketing page capture as its
          // visitors see it rather than as an empty app shell.
          gotoOptions: { waitUntil: 'networkidle0', timeout: 30_000 },
          screenshotOptions: { type: 'jpeg', quality: 78, fullPage },
        }),
      },
    );
  } catch (error) {
    throw new ScreenshotUnavailableError(
      'provider',
      controller.signal.aborted
        ? `${target.hostname} did not finish rendering within ${RENDER_TIMEOUT_MS / 1000}s.`
        : `The page renderer could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new ScreenshotUnavailableError('provider', await readProviderError(response));

  const mimeType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() || 'image/jpeg';
  // A 200 that is not an image is the renderer reporting a failure in a JSON envelope.
  if (!mimeType.startsWith('image/')) throw new ScreenshotUnavailableError('provider', await readProviderError(response));

  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength) throw new ScreenshotUnavailableError('provider', `${target.hostname} rendered an empty image.`);
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ScreenshotUnavailableError(
      'too-large',
      `The capture of ${target.hostname} is ${Math.round(bytes.byteLength / 1024)}KB, over the ${MAX_IMAGE_BYTES / 1024 / 1024}MB a canvas object may hold. Capture the first screen instead of the full page.`,
    );
  }

  return {
    url: target.toString(),
    imageDataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
    mimeType,
    width: size.width,
    height: size.height,
    viewport,
    fullPage,
    byteSize: bytes.byteLength,
    provider: 'cloudflare-browser-rendering',
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Cached capture — the one callers should use.
 *
 * Failures are deliberately NOT cached: a throwing loader leaves the cache untouched,
 * so a page that timed out once is retryable on the very next turn. `env` may be absent
 * (tests, non-Worker callers); the helper's contract is "no KV → call the loader".
 */
export async function captureWebScreenshotCached(
  env: Env | undefined,
  rawUrl: string,
  options: WebScreenshotOptions = {},
): Promise<WebScreenshotResult> {
  const viewport = isScreenshotViewport(options.viewport) ? options.viewport : 'desktop';
  const fullPage = options.fullPage === true;
  return getOrSetCached<WebScreenshotResult>(
    env as Env,
    `web-shot:${viewport}:${fullPage ? 'full' : 'screen'}:${rawUrl.trim()}`,
    () => captureWebScreenshot(env, rawUrl, { viewport, fullPage }),
    { kvTtlSeconds: SHOT_CACHE_KV_TTL_SECONDS, l1TtlMs: SHOT_CACHE_L1_TTL_MS },
  );
}
