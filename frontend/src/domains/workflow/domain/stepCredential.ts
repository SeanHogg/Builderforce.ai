import type { Integration } from './stepIntegrations';

/**
 * The credential a step runs with — the part of a step's config that names WHICH
 * stored connection it uses.
 *
 * The id points at a row of the tenant's `integration_credentials` (the same vault
 * Settings ▸ Integrations writes). The secret itself never travels in a step's
 * config: the server resolves the id, scoped to the run's tenant, when the step
 * executes (`api/src/application/workflow/mcpNode.ts`). Omitted = the tenant's
 * single enabled credential for the provider, and an ambiguous match fails closed.
 */
export interface StepCredentialConfig {
  credentialId?: string;
}

/** The config key the server reads. One constant so the picker and the contract agree. */
export const STEP_CREDENTIAL_KEY = 'credentialId' satisfies keyof StepCredentialConfig;

export function credentialIdOf(config: Record<string, unknown>): string {
  const id = config[STEP_CREDENTIAL_KEY];
  return typeof id === 'string' ? id : '';
}

/**
 * Whether a placed integration takes a stored credential. Only `mcp`-kind presets
 * execute through the credential vault; `llm` presets ride the tenant's BYO /
 * gateway keys, and a `trigger` collects data rather than calling out.
 */
export function stepUsesCredential(integration: Integration | undefined): integration is Integration {
  return integration != null && integration.kind === 'mcp' && integration.auth !== 'none';
}

/**
 * Whether the cloud runtime can actually EXECUTE a provider. The runtime's own
 * provider catalog is the authority and the connect catalog (`/api/integrations/
 * connectable`) is built from it: a runnable provider carries a `family`
 * (data / marketing / enrichment) and an `http` transport. A legacy key-only
 * provider (github, jira, slack, …) has no family, and a `tcp` provider is stored
 * but cannot run from the cloud — a step on either would fail every run. No list is
 * restated here, so a provider the runtime gains becomes runnable on its own.
 */
export function isRunnableProvider(
  descriptor: { family: string | null; transport: 'http' | 'tcp' } | null | undefined,
): boolean {
  return descriptor != null && descriptor.family != null && descriptor.transport === 'http';
}

/**
 * The stored provider id for a palette integration. The palette writes kebab-case
 * (`google-drive`), the credential enum stores snake_case (`google_drive`).
 */
export function credentialProviderFor(integration: Pick<Integration, 'id'>): string {
  return integration.id.replace(/-/g, '_');
}
