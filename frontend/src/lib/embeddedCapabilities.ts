import type { CustomerEmbedFeatureKey } from './builderforceApi';

export type EmbeddedCapabilityCategory = 'engage' | 'measure' | 'govern' | 'operate';

export interface EmbeddedCapabilityDefinition {
  key: CustomerEmbedFeatureKey;
  icon: string;
  category: EmbeddedCapabilityCategory;
  apiName: string;
  examples: number;
}

/** Canonical presentation registry for the customer-site embed control plane. */
export const EMBEDDED_CAPABILITIES: readonly EmbeddedCapabilityDefinition[] = [
  { key: 'feedback_widget', icon: 'message', category: 'engage', apiName: 'feedback', examples: 2 },
  { key: 'support_widget', icon: 'message', category: 'engage', apiName: 'support', examples: 2 },
  { key: 'lead_forms', icon: 'document', category: 'engage', apiName: 'forms', examples: 4 },
  { key: 'onboarding', icon: 'target', category: 'engage', apiName: 'onboarding', examples: 2 },
  { key: 'usage_tracking', icon: 'activity', category: 'measure', apiName: 'analytics', examples: 5 },
  { key: 'heatmaps', icon: 'activity', category: 'measure', apiName: 'heatmaps', examples: 1 },
  { key: 'feature_management', icon: 'flag', category: 'measure', apiName: 'flags', examples: 3 },
  { key: 'cookie_consent', icon: 'check', category: 'govern', apiName: 'consent', examples: 1 },
  { key: 'terms_gate', icon: 'shield', category: 'govern', apiName: 'terms', examples: 1 },
  { key: 'push_notifications', icon: 'alert', category: 'engage', apiName: 'push', examples: 4 },
  { key: 'sourcing', icon: 'search', category: 'operate', apiName: 'sourcing', examples: 4 },
  { key: 'hr_widget', icon: 'people', category: 'operate', apiName: 'hr', examples: 1 },
  { key: 'status_page', icon: 'monitor', category: 'operate', apiName: 'status', examples: 2 },
] as const;

export const EMBEDDED_CAPABILITY_KEYS = EMBEDDED_CAPABILITIES.map(({ key }) => key);

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
