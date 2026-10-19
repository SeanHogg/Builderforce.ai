/**
 * Offline behaviour for host capabilities (G21).
 *
 * This module only classifies. It does not fetch, enqueue, or substitute a
 * server operation. An unknown capability is blocked.
 */

export const HOST_CAPABILITIES = [
  'meeting',
  'attachment-upload',
  'attachment-manifest',
  'cloud-mcp-tool',
  'local-file-read',
  'local-file-write',
  'gateway-inference',
  'git-push',
  'local-audit',
] as const;

export type HostCapability = (typeof HOST_CAPABILITIES)[number];

/** Closed set. There is no fallback and no server-substitute. */
export type OfflineBehaviour = 'local' | 'blocked' | 'connected-only';

export interface CapabilityMatrixRow {
  readonly capability: string;
  readonly behaviour: OfflineBehaviour;
  readonly reason: string;
}

const KNOWN: ReadonlySet<string> = new Set(HOST_CAPABILITIES);

function row(capability: HostCapability, behaviour: OfflineBehaviour, reason: string): CapabilityMatrixRow {
  return Object.freeze({ capability, behaviour, reason });
}

export const CAPABILITY_MATRIX: Readonly<Record<HostCapability, CapabilityMatrixRow>> = Object.freeze({
  meeting: row(
    'meeting',
    'connected-only',
    'Meetings require a live connected session and must not be replaced by a server call while offline.',
  ),
  'attachment-upload': row(
    'attachment-upload',
    'connected-only',
    'Attachment upload requires a connected account and must not be replaced by a silent server upload while offline.',
  ),
  'attachment-manifest': row(
    'attachment-manifest',
    'local',
    'The attachment manifest and its local blob are stored on the device without a platform request.',
  ),
  'cloud-mcp-tool': row(
    'cloud-mcp-tool',
    'connected-only',
    'Cloud MCP tools run only while connected and must not be enqueued or replaced by a server call while offline.',
  ),
  'local-file-read': row(
    'local-file-read',
    'local',
    'Reading a local file uses the host filesystem and does not contact the platform.',
  ),
  'local-file-write': row(
    'local-file-write',
    'local',
    'Writing a local file uses the host filesystem and does not contact the platform.',
  ),
  'gateway-inference': row(
    'gateway-inference',
    'connected-only',
    'Gateway inference is a connected grant and must not be used as an offline fallback.',
  ),
  'git-push': row(
    'git-push',
    'connected-only',
    'Pushing to a Git remote requires a connection and must not be rewritten as a local or server substitute.',
  ),
  'local-audit': row(
    'local-audit',
    'local',
    'A local audit runs against packaged definitions on the device and completes without a cloud audit.',
  ),
});

const UNKNOWN_REASON = 'An unknown capability is blocked and is never substituted with a server operation.';

export function isHostCapability(value: string): value is HostCapability {
  return KNOWN.has(value);
}

/**
 * Returns the frozen table row for a known capability.
 * An unknown capability is blocked. This function never throws and never
 * performs or falls through to a server call.
 */
export function offlineBehaviour(capability: string): CapabilityMatrixRow {
  if (isHostCapability(capability)) return CAPABILITY_MATRIX[capability];
  return Object.freeze({
    capability,
    behaviour: 'blocked',
    reason: UNKNOWN_REASON,
  });
}
