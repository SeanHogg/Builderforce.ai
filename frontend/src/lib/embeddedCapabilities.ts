import type { CustomerEmbedFeatureKey } from './builderforceApi';

export type EmbeddedCapabilityCategory = 'engage' | 'measure' | 'govern' | 'operate';

export interface EmbeddedCapabilityDefinition {
  key: CustomerEmbedFeatureKey;
  icon: string;
  category: EmbeddedCapabilityCategory;
  apiName: string;
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

/** Canonical presentation registry for the customer-site embed control plane. */
export const EMBEDDED_CAPABILITIES: readonly EmbeddedCapabilityDefinition[] = [
  { key: 'feedback_widget', icon: 'message', category: 'engage', apiName: 'feedback', examples: 2, replaces: ['Canny', 'Productboard'], benchmarkMonthlyUsd: 79 },
  { key: 'support_widget', icon: 'message', category: 'engage', apiName: 'support', examples: 2, replaces: ['Intercom', 'Zendesk'], benchmarkMonthlyUsd: 99 },
  { key: 'lead_forms', icon: 'document', category: 'engage', apiName: 'forms', examples: 4, replaces: ['Typeform', 'HubSpot Forms'], benchmarkMonthlyUsd: 50 },
  { key: 'onboarding', icon: 'target', category: 'engage', apiName: 'onboarding', examples: 2, replaces: ['Appcues', 'Pendo'], benchmarkMonthlyUsd: 249 },
  { key: 'usage_tracking', icon: 'activity', category: 'measure', apiName: 'analytics', examples: 5, replaces: ['Amplitude', 'Mixpanel'], benchmarkMonthlyUsd: 99 },
  { key: 'heatmaps', icon: 'activity', category: 'measure', apiName: 'heatmaps', examples: 1, replaces: ['Hotjar', 'FullStory'], benchmarkMonthlyUsd: 40 },
  { key: 'feature_management', icon: 'flag', category: 'measure', apiName: 'flags', examples: 3, replaces: ['LaunchDarkly', 'Split'], benchmarkMonthlyUsd: 120 },
  { key: 'cookie_consent', icon: 'check', category: 'govern', apiName: 'consent', examples: 1, replaces: ['OneTrust', 'Cookiebot'], benchmarkMonthlyUsd: 30 },
  { key: 'terms_gate', icon: 'shield', category: 'govern', apiName: 'terms', examples: 1, replaces: ['Ironclad', 'DocuSign'], benchmarkMonthlyUsd: 45 },
  { key: 'push_notifications', icon: 'alert', category: 'engage', apiName: 'push', examples: 4, replaces: ['OneSignal', 'Braze'], benchmarkMonthlyUsd: 60 },
  { key: 'sourcing', icon: 'search', category: 'operate', apiName: 'sourcing', examples: 4, replaces: ['Apollo', 'Clearbit'], benchmarkMonthlyUsd: 99 },
  { key: 'hr_widget', icon: 'people', category: 'operate', apiName: 'hr', examples: 1, replaces: ['Workable', 'Greenhouse'], benchmarkMonthlyUsd: 149 },
  { key: 'status_page', icon: 'monitor', category: 'operate', apiName: 'status', examples: 2, replaces: ['Statuspage', 'Better Stack'], benchmarkMonthlyUsd: 29 },
] as const;

export const EMBEDDED_CAPABILITY_KEYS = EMBEDDED_CAPABILITIES.map(({ key }) => key);

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

export function embeddedCapability(key: CustomerEmbedFeatureKey): EmbeddedCapabilityDefinition {
  return EMBEDDED_CAPABILITIES.find((item) => item.key === key) ?? EMBEDDED_CAPABILITIES[0];
}

export function unifiedEmbedSnippet(publicKey: string): string {
  return `<script\n  src="https://cdn.builderforce.ai/embed/v1.js"\n  data-builderforce-key="${publicKey}"\n  async\n></script>`;
}

export function capabilitySnippet(key: CustomerEmbedFeatureKey): string {
  const api = embeddedCapability(key).apiName;
  switch (key) {
    case 'usage_tracking':
      return `window.BuilderForce.identify('user-123', { plan: 'pro' });\nwindow.BuilderForce.track('project_published', { projectId: '123' });`;
    case 'feature_management':
      return `const enabled = window.BuilderForce.flags.isEnabled('beta-launch', false);`;
    case 'lead_forms':
      return `<div data-builderforce-form="FORM_ID"></div>`;
    case 'sourcing':
      return `window.BuilderForce.sourcing.lookup({ kind: 'email', value: 'person@example.com' });`;
    case 'status_page':
      return `<div data-builderforce-status></div>`;
    case 'cookie_consent':
    case 'terms_gate':
    case 'heatmaps':
    case 'onboarding':
      return `// Automatic after this capability is enabled.\nwindow.BuilderForce.${api}.ready();`;
    default:
      return `window.BuilderForce.${api}.open();`;
  }
}
