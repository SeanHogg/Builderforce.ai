/**
 * Offline behaviour for meetings, attachments, cloud-only tools, and the
 * eight platform capabilities (G21).
 *
 * One table. Denied is the default for anything not listed. This module only
 * classifies: it imports nothing, enqueues nothing, and never issues a
 * platform request. A meeting or an attachment is queue or local, so it cannot
 * become a silent cloud call. A cloud-only tool is not available offline.
 */

export const OFFLINE_BEHAVIOURS = ['local', 'queue', 'denied', 'cloud-only'] as const;

export type OfflineBehaviour = (typeof OFFLINE_BEHAVIOURS)[number];

/**
 * The eight platform capabilities named by `policy.ts`. Duplicated here so
 * this table does not import the policy store.
 */
export const PLATFORM_CAPABILITIES = [
  'synchronize',
  'gateway-inference',
  'connected-feature',
  'authenticate',
  'model-download',
  'direct-provider',
  'external-mcp',
  'git-remote',
] as const;

export type PlatformCapabilityName = (typeof PLATFORM_CAPABILITIES)[number];

const LOCAL = 'local' satisfies OfflineBehaviour;
const QUEUE = 'queue' satisfies OfflineBehaviour;
const CLOUD_ONLY = 'cloud-only' satisfies OfflineBehaviour;

/**
 * Every offline-relevant capability and its behaviour. Meetings and
 * attachments are queue or local. Cloud-only tools, and every platform
 * capability, are cloud-only. Denied is not a row: it is the default.
 */
export const CAPABILITY_MATRIX: Readonly<Record<string, OfflineBehaviour>> = Object.freeze(
  Object.assign(Object.create(null), {
    meeting: QUEUE,
    'meeting-join': QUEUE,
    'attachment-manifest': LOCAL,
    'attachment-blob': LOCAL,
    'attachment-upload': QUEUE,
    'server-summary': LOCAL,
    'project-panel': LOCAL,
    'cloud-mcp-tool': CLOUD_ONLY,
    'mcp-management': CLOUD_ONLY,
    'cloud-execution': CLOUD_ONLY,
    'oauth-management': CLOUD_ONLY,
    'remote-creation': CLOUD_ONLY,
    'remote-session-read': CLOUD_ONLY,
    'approval-decision': CLOUD_ONLY,
    synchronize: CLOUD_ONLY,
    'gateway-inference': CLOUD_ONLY,
    'connected-feature': CLOUD_ONLY,
    authenticate: CLOUD_ONLY,
    'model-download': CLOUD_ONLY,
    'direct-provider': CLOUD_ONLY,
    'external-mcp': CLOUD_ONLY,
    'git-remote': CLOUD_ONLY,
  }),
);

const KNOWN_BEHAVIOUR: ReadonlySet<string> = new Set(OFFLINE_BEHAVIOURS);

/**
 * The offline behaviour for a capability. An unknown name, including a
 * prototype key, is denied. This never throws and never performs a call.
 */
export function offlineBehaviour(capability: string): OfflineBehaviour {
  if (typeof capability !== 'string' || !Object.hasOwn(CAPABILITY_MATRIX, capability)) return 'denied';
  const value = CAPABILITY_MATRIX[capability];
  return KNOWN_BEHAVIOUR.has(value) ? value : 'denied';
}
