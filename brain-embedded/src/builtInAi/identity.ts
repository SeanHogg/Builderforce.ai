/**
 * Which built-in model this browser ships, as DATA — the ONE place vendor identity is
 * decided (PRD 42 · Part A1). Nothing outside this file reads a browser/vendor global to
 * pick a model id, a brand label or a fallback window; a new browser or model is a row
 * here, not a branch somewhere else.
 *
 * Chrome exposes Gemini Nano, Edge exposes Phi-4-mini, and both speak the same Prompt /
 * Writing-Assistance APIs. A Chromium build that exposes the API but is neither reads as
 * `unknown` and is labelled generically — it is still servable, just not branded.
 */

/** The browser vendors whose built-in models we name. */
export type BuiltInAiVendor = 'chrome' | 'edge' | 'unknown';

/** The identity of the built-in model a browser exposes through the Prompt API. */
export interface BuiltInModelIdentity {
  vendor: BuiltInAiVendor;
  /** The bare model id (`local/browser/<model>`), e.g. `gemini-nano`. */
  model: string;
  /** Brand token, NOT localized: `Gemini Nano` · `Phi-4-mini` · `Built-in model`. */
  label: string;
  /**
   * The context window assumed when the browser will not say. Conservative — the plan
   * sends a long call to the cloud rather than discovering the overflow at the engine.
   */
  fallbackContextTokens: number;
}

/** The minimal `navigator.userAgentData` shape we read. */
interface NavigatorUserAgentDataLike {
  brands?: ReadonlyArray<{ brand: string; version: string }>;
}

/** The minimal `navigator` shape we read — injectable for tests and non-DOM hosts. */
export interface NavigatorLike {
  userAgentData?: NavigatorUserAgentDataLike;
  userAgent?: string;
}

const FALLBACK_CONTEXT_TOKENS = 4_096;

/**
 * Vendor identity as rows. `unknown` is last and generic; a Chromium build that exposes
 * the Prompt API but is neither Chrome nor Edge is still a servable built-in model.
 */
export const BUILT_IN_MODELS: Record<BuiltInAiVendor, BuiltInModelIdentity> = {
  chrome: {
    vendor: 'chrome',
    model: 'gemini-nano',
    label: 'Gemini Nano (Chrome)',
    fallbackContextTokens: FALLBACK_CONTEXT_TOKENS,
  },
  edge: {
    vendor: 'edge',
    model: 'phi-4-mini',
    label: 'Phi-4-mini (Edge)',
    fallbackContextTokens: FALLBACK_CONTEXT_TOKENS,
  },
  unknown: {
    vendor: 'unknown',
    model: 'built-in',
    label: 'Built-in model',
    fallbackContextTokens: FALLBACK_CONTEXT_TOKENS,
  },
};

/** The browser's own `navigator`, when there is one (SSR and Node hosts have none). */
function defaultNavigator(): NavigatorLike | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as NavigatorLike);
}

function vendorFromUserAgentData(brands: NonNullable<NavigatorUserAgentDataLike['brands']>): BuiltInAiVendor {
  // A browser may list several brands (e.g. Chromium alongside its own). Match the
  // most specific brand first so Edge is not read as Chromium/Chrome.
  const names = brands.map((b) => b.brand);
  if (names.includes('Microsoft Edge')) return 'edge';
  if (names.includes('Google Chrome')) return 'chrome';
  return 'unknown';
}

// Opera and other Chromium forks on this UA fallback read as chrome; acceptable because Chromium sends userAgentData on secure contexts.
function vendorFromUserAgent(nav: NavigatorLike): BuiltInAiVendor | undefined {
  const ua = nav.userAgent;
  if (!ua) return undefined;
  if (/Edg(?:e|A|iOS)?\//.test(ua) || /Microsoft Edge/.test(ua)) return 'edge';
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'chrome';
  return undefined;
}

/**
 * The built-in model identity for THIS browser. Vendor comes from
 * `navigator.userAgentData.brands` when present, else a single user-agent regex; anything
 * unrecognized is `unknown` (labelled "Built-in model", still servable). Never throws —
 * any host without a readable navigator reads as `unknown`.
 */
export function builtInModelIdentity(nav: NavigatorLike | undefined = defaultNavigator()): BuiltInModelIdentity {
  // userAgentData present ⇒ trust it: no Edge/Chrome brand (Brave, Opera, Samsung) is
  // `unknown`, never re-read from the UA string (which those browsers spoof as Chrome).
  const brands = nav?.userAgentData?.brands;
  const vendor = brands ? vendorFromUserAgentData(brands) : ((nav && vendorFromUserAgent(nav)) ?? 'unknown');
  return BUILT_IN_MODELS[vendor];
}
