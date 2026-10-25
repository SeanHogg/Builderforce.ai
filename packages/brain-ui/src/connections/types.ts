/**
 * The port the composer's "Connected accounts" section reads and acts through, and its copy.
 *
 * The port is STRUCTURAL: `@builderforce/provider-connect`'s `createProviderConnectionsClient`
 * satisfies it, and each host builds one over its own authenticated gateway call. This
 * package is published and cannot depend on that private one, so the shapes are restated
 * here — only the fields the section reads.
 */
import { stringsFrom, type LabelLookup } from '../labelCatalog';

export type ConnectionHealth = 'ok' | 'capacity' | 'not_entitled' | 'rejected' | 'unresolved';

export interface ProviderConnection {
  provider: string;
  label: string;
  authType: 'oauth' | 'api_key';
  health: ConnectionHealth;
  reconnectable: boolean;
}

export interface ProviderConnectStart {
  grant: 'device' | 'paste';
  authorizeUrl: string;
  state: string;
  userCode: string | null;
  intervalMs: number;
}

/**
 * Error contract: a rejected `start`, `completePaste` or `awaitDevice` carries
 * `{ reason: 'unavailable' | 'denied' | 'expired' | 'cancelled' | 'failed', detail?: string }`
 * (provider-connect's `ProviderConnectError`); anything else reads as `failed`.
 */
export interface ProviderConnectionsPort {
  /** `null` ⇒ the gateway refused this caller the list (403) — the section says so. */
  list(): Promise<ProviderConnection[] | null>;
  /** `health` is null when the probe could not say (no verdict persisted) — the row keeps its own. */
  test(provider: string): Promise<{ ok: boolean; health: ConnectionHealth | null; message: string | null }>;
  start(provider: string): Promise<ProviderConnectStart>;
  completePaste(provider: string, code: string, state: string): Promise<void>;
  awaitDevice(provider: string, start: ProviderConnectStart, signal: AbortSignal): Promise<void>;
}

/** What the section needs from its host: the port, and where an authorize page opens. */
export interface ComposerConnections {
  client: ProviderConnectionsPort;
  /** Open the provider's sign-in page outside the panel (a browser tab). */
  openUrl: (url: string) => void;
}

export interface ConnectionsLabels {
  heading: string;
  empty: string;
  loadFailed: string;
  /** The gateway refused this caller the list. */
  unavailable: string;
  authOauth: string;
  authApiKey: string;
  healthOk: string;
  healthCapacity: string;
  healthNotEntitled: string;
  healthRejected: string;
  healthUnresolved: string;
  test: string;
  testing: string;
  testOk: string;
  reconnect: string;
  pasteHint: string;
  pastePlaceholder: string;
  finish: string;
  finishing: string;
  cancel: string;
  /** "{code}" — the device code the provider's page shows. */
  deviceHint: string;
  reconnected: string;
  errDenied: string;
  errExpired: string;
  errStart: string;
  errFailed: string;
}

export const DEFAULT_CONNECTIONS_LABELS: ConnectionsLabels = {
  heading: 'Connected accounts',
  empty: 'No provider accounts connected.',
  loadFailed: 'Could not load connected accounts.',
  unavailable: 'Connected accounts are not available from here.',
  authOauth: 'Subscription',
  authApiKey: 'API key',
  healthOk: 'Working',
  healthCapacity: 'Usage limit reached — add credits or wait for the reset',
  healthNotEntitled: 'Signed in, but the plan does not cover this model',
  healthRejected: 'Sign-in expired — reconnect',
  healthUnresolved: 'Credential could not be read — reconnect',
  test: 'Test',
  testing: 'Testing…',
  testOk: 'Connection works',
  reconnect: 'Reconnect',
  pasteHint: 'Sign in on the page that opened, then paste the code it shows.',
  pastePlaceholder: 'Paste code',
  finish: 'Finish',
  finishing: 'Finishing…',
  cancel: 'Cancel',
  deviceHint: 'Approve in your browser — the page shows code {code}.',
  reconnected: 'Reconnected',
  errDenied: 'The connection was declined.',
  errExpired: 'That code expired — reconnect again.',
  errStart: 'Could not start reconnecting.',
  errFailed: 'Could not reconnect.',
};

export function connectionsLabels(overrides?: Partial<ConnectionsLabels>): ConnectionsLabels {
  return overrides ? { ...DEFAULT_CONNECTIONS_LABELS, ...overrides } : DEFAULT_CONNECTIONS_LABELS;
}

/** THE section's copy from a host catalog — canonical keys are the field names; `{code}` must come back literal. */
export function connectionsLabelsFrom(lookup: LabelLookup): ConnectionsLabels {
  return stringsFrom(DEFAULT_CONNECTIONS_LABELS, lookup);
}

const HEALTH_LABEL: Record<ConnectionHealth, keyof ConnectionsLabels> = {
  ok: 'healthOk',
  capacity: 'healthCapacity',
  not_entitled: 'healthNotEntitled',
  rejected: 'healthRejected',
  unresolved: 'healthUnresolved',
};

export function healthLabel(health: ConnectionHealth, labels: ConnectionsLabels): string {
  return labels[HEALTH_LABEL[health]];
}
