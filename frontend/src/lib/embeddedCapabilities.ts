export type EmbeddedCapabilityCategory = 'engage' | 'measure' | 'govern' | 'operate';

/**
 * A capability's key, as the API spells it (`/api/embed/features/<key>`).
 *
 * Derived from the registry rows below, so the union and the catalog cannot disagree:
 * `builderforceApi`'s `CustomerEmbedFeatureKey` is this same union read back through
 * {@link EMBEDDED_CAPABILITY_KEYS}, and adding a row here is the whole act of adding a
 * key — there is no second list of thirteen literals to keep in step.
 */
export type EmbeddedCapabilityKey = (typeof CAPABILITY_ROWS)[number]['key'];

export interface EmbeddedCapabilityDefinition {
  key: EmbeddedCapabilityKey;
  icon: string;
  category: EmbeddedCapabilityCategory;
  examples: number;
  /**
   * The point tools a team buys instead when they do NOT have this capability.
   *
   * Brand names, so they are DATA rather than catalog strings — a product name is
   * not translated, and routing thirteen of these through five message catalogs
   * would put the same literal in five files with nothing to gain.
   */
  replaces: readonly string[];
  /**
   * Approximate published ENTRY-TIER list price, per month in USD, of one
   * comparable tool from {@link replaces} for a small team.
   *
   * It is a comparison anchor, not a quote, and the surface that renders it says
   * so. Kept here rather than computed in the component so the number a visitor
   * is shown and the number a test asserts are the same number.
   */
  benchmarkMonthlyUsd: number;
}

/** The rows, `as const` so each `key` stays a literal the union above is read from. */
const CAPABILITY_ROWS = [
  { key: 'feedback_widget', icon: 'message', category: 'engage', examples: 2, replaces: ['Canny', 'Productboard'], benchmarkMonthlyUsd: 79 },
  { key: 'support_widget', icon: 'message', category: 'engage', examples: 2, replaces: ['Intercom', 'Zendesk'], benchmarkMonthlyUsd: 99 },
  { key: 'lead_forms', icon: 'document', category: 'engage', examples: 4, replaces: ['Typeform', 'HubSpot Forms'], benchmarkMonthlyUsd: 50 },
  { key: 'onboarding', icon: 'target', category: 'engage', examples: 2, replaces: ['Appcues', 'Pendo'], benchmarkMonthlyUsd: 249 },
  { key: 'usage_tracking', icon: 'activity', category: 'measure', examples: 5, replaces: ['Amplitude', 'Mixpanel'], benchmarkMonthlyUsd: 99 },
  { key: 'heatmaps', icon: 'activity', category: 'measure', examples: 1, replaces: ['Hotjar', 'FullStory'], benchmarkMonthlyUsd: 40 },
  { key: 'feature_management', icon: 'flag', category: 'measure', examples: 3, replaces: ['LaunchDarkly', 'Split'], benchmarkMonthlyUsd: 120 },
  { key: 'cookie_consent', icon: 'check', category: 'govern', examples: 1, replaces: ['OneTrust', 'Cookiebot'], benchmarkMonthlyUsd: 30 },
  { key: 'terms_gate', icon: 'shield', category: 'govern', examples: 1, replaces: ['Ironclad', 'DocuSign'], benchmarkMonthlyUsd: 45 },
  { key: 'push_notifications', icon: 'alert', category: 'engage', examples: 4, replaces: ['OneSignal', 'Braze'], benchmarkMonthlyUsd: 60 },
  { key: 'sourcing', icon: 'search', category: 'operate', examples: 4, replaces: ['Apollo', 'Clearbit'], benchmarkMonthlyUsd: 99 },
  { key: 'hr_widget', icon: 'people', category: 'operate', examples: 1, replaces: ['Workable', 'Greenhouse'], benchmarkMonthlyUsd: 149 },
  { key: 'status_page', icon: 'monitor', category: 'operate', examples: 2, replaces: ['Statuspage', 'Better Stack'], benchmarkMonthlyUsd: 29 },
] as const satisfies readonly (Omit<EmbeddedCapabilityDefinition, 'key'> & { key: string })[];

/** Canonical presentation registry for the customer-site embed control plane. */
export const EMBEDDED_CAPABILITIES: readonly EmbeddedCapabilityDefinition[] = CAPABILITY_ROWS;

/** Every capability key, in catalog order — the API's `CustomerEmbedFeatureKey` is read off this. */
export const EMBEDDED_CAPABILITY_KEYS: readonly EmbeddedCapabilityKey[] = CAPABILITY_ROWS.map(({ key }) => key);

/**
 * What the whole catalog is worth against the stack it displaces.
 *
 * DERIVED from the rows above rather than typed as a headline figure, because a
 * headline figure is how "replaces $1,148/mo of tooling" survives three
 * capabilities being added and stays wrong on the page nobody re-reads.
 */
export const EMBEDDED_STACK_BENCHMARK_MONTHLY = EMBEDDED_CAPABILITIES
  .reduce((total, item) => total + item.benchmarkMonthlyUsd, 0);

/** Every displaced tool, de-duplicated, in catalog order. */
export const EMBEDDED_REPLACED_TOOLS: readonly string[] =
  [...new Set(EMBEDDED_CAPABILITIES.flatMap((item) => item.replaces))];

/**
 * The ONE install tag for a customer site.
 *
 * `data-builderforce-key` (the workspace key) drives the widget capabilities.
 * Session replay and heatmaps are a separate runtime that the embed boots ONLY
 * from `data-site` — an Insights site key (`replay-sdk/src/embed.ts`) — and the
 * workspace key is never used as one. So the tag carries `data-site` exactly
 * when the workspace has an Insights site; without one, nothing this tag loads
 * records, and the surface says so rather than implying otherwise.
 */
export function unifiedEmbedSnippet(publicKey: string, replaySiteKey: string | null = null): string {
  const site = replaySiteKey ? `\n  data-site="${replaySiteKey}"` : '';
  return `<script\n  src="https://cdn.builderforce.ai/embed/v1.js"\n  data-builderforce-key="${publicKey}"${site}\n  async\n></script>`;
}

/**
 * The page-side API a capability's runtime actually ships, as copyable code —
 * keyed by capability, and ONLY for a capability whose runtime exists.
 *
 * The unified embed (`replay-sdk/src/embed.ts`) boots session replay when its tag
 * carries `data-site`, and the replay loader installs `window.BFReplay` (a stub
 * that queues calls until the recorder is up — `replay-sdk/src/publicApi.ts`).
 * No other capability has a page API, so none is advertised: a snippet for an API
 * nobody ships is a promise the product breaks on the customer's page.
 */
const CAPABILITY_SNIPPETS: Partial<Record<EmbeddedCapabilityKey, string>> = {
  heatmaps: [
    "window.BFReplay?.event('checkout_started');",
    "window.BFReplay?.tag('plan', 'pro');",
    "window.BFReplay?.identify('user-123', { plan: 'pro' });",
    'window.BFReplay?.keep();',
    'window.BFReplay?.consent(true);',
  ].join('\n'),
};

/** The capability's page API as code, or null when its runtime ships none. */
export function capabilitySnippet(key: EmbeddedCapabilityKey): string | null {
  return CAPABILITY_SNIPPETS[key] ?? null;
}
