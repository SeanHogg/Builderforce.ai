/**
 * Offline behaviour for host capabilities (G21).
 *
 * Every capability a host can reach for has exactly one offline behaviour:
 *
 * - `local`          it completes on the device with no platform request.
 * - `queued`         a durable local write that a later sync replays.
 * - `connected-only` it is refused while the platform is denied.
 * - `blocked`        reserved for an unknown capability, never a table row.
 *
 * This module only classifies. It imports no network client, enqueues
 * nothing, and substitutes nothing. A `connected-only` capability is refused
 * explicitly through `CapabilityRefusedError` instead of being silently
 * dropped, and only a `queued` row may be handed to a durable queue: an
 * arbitrary MCP call is never enqueued as offline history.
 */

/**
 * Platform grants this table classifies. Named here so the matrix stays a
 * pure classifier with no dependency on the policy store.
 */
export type CapabilityPolicy =
  | 'synchronize'
  | 'gateway-inference'
  | 'connected-feature'
  | 'authenticate'
  | 'model-download'
  | 'direct-provider'
  | 'external-mcp'
  | 'git-remote';

/** Durable local records a queued row may name. A subset of the local entity types. */
export type CapabilityRecord =
  | 'project'
  | 'ticket'
  | 'message'
  | 'audit-finding'
  | 'memory-fact'
  | 'attachment-manifest'
  | 'remediation';

/** The user-facing surface a capability belongs to. */
export const CAPABILITY_SURFACES = [
  'meeting',
  'attachment',
  'cloud-tool',
  'account',
  'remote-data',
  'local-file',
  'local-runtime',
  'chat',
  'work',
  'audit',
  'memory',
  'git',
] as const;

export type CapabilitySurface = (typeof CAPABILITY_SURFACES)[number];

export const HOST_CAPABILITIES = [
  // Meetings: a live session cannot exist without the platform.
  'meeting',
  'meeting-join',
  // Attachments: the blob and the manifest stay local, the upload does not.
  'attachment-manifest',
  'attachment-local-blob',
  'attachment-upload',
  // Cloud-only tools and cloud execution.
  'cloud-mcp-tool',
  'mcp-management',
  'cloud-execution',
  'gateway-inference',
  // Connected account and remote data.
  'oauth-management',
  'connected-feature',
  'remote-creation',
  'approval-decision',
  'server-summary',
  'remote-session-read',
  'project-panel',
  // Local files and local runtime.
  'local-file-read',
  'local-file-write',
  'model-download',
  'direct-provider',
  'local-inference',
  'synchronize',
  // Durable local writes a later sync replays.
  'local-message-write',
  'local-project-write',
  'local-ticket-write',
  'local-audit',
  'local-audit-finding',
  'local-remediation',
  'local-memory-recall',
  'local-fact-publish',
  // Git remotes.
  'git-push',
] as const;

export type HostCapability = (typeof HOST_CAPABILITIES)[number];

/**
 * Closed set. There is no fallback and no server-substitute, and a host that
 * asks for a capability outside this table is refused rather than guessed at.
 */
export type OfflineBehaviour = 'local' | 'queued' | 'connected-only' | 'blocked';

/** How fresh a read is: live from the device, or a cached platform read. */
export type DataFreshness = 'live' | 'cached-stale';

export interface CapabilityMatrixRow {
  readonly capability: string;
  readonly surface: CapabilitySurface | null;
  readonly behaviour: OfflineBehaviour;
  /** The policy capability that gates this row, when the platform owns it. */
  readonly policyCapability: CapabilityPolicy | null;
  /** The durable local record this row writes, when it writes one at all. */
  readonly entityType: CapabilityRecord | null;
  readonly freshness: DataFreshness;
  readonly reason: string;
}

interface RowSpec {
  readonly surface: CapabilitySurface;
  readonly behaviour: Exclude<OfflineBehaviour, 'blocked'>;
  readonly policyCapability?: CapabilityPolicy;
  readonly entityType?: CapabilityRecord;
  readonly freshness?: DataFreshness;
  readonly reason: string;
}

function row(capability: HostCapability, spec: RowSpec): CapabilityMatrixRow {
  return Object.freeze({
    capability,
    surface: spec.surface,
    behaviour: spec.behaviour,
    policyCapability: spec.policyCapability ?? null,
    entityType: spec.entityType ?? null,
    freshness: spec.freshness ?? 'live',
    reason: spec.reason,
  });
}

export const CAPABILITY_MATRIX: Readonly<Record<HostCapability, CapabilityMatrixRow>> = Object.freeze({
  'meeting': row('meeting', {
    surface: 'meeting',
    behaviour: 'connected-only',
    policyCapability: 'connected-feature',
    reason: 'A meeting is a live connected session and is refused offline instead of being queued as history.',
  }),
  'meeting-join': row('meeting-join', {
    surface: 'meeting',
    behaviour: 'connected-only',
    policyCapability: 'connected-feature',
    reason: 'Joining a meeting opens a connected socket and is refused offline rather than recorded locally.',
  }),

  'attachment-manifest': row('attachment-manifest', {
    surface: 'attachment',
    behaviour: 'local',
    entityType: 'attachment-manifest',
    reason: 'The manifest describes a local blob held on the device and needs no platform request.',
  }),
  'attachment-local-blob': row('attachment-local-blob', {
    surface: 'attachment',
    behaviour: 'local',
    reason: 'The attachment bytes are read from local storage and never round-trip through the platform.',
  }),
  'attachment-upload': row('attachment-upload', {
    surface: 'attachment',
    behaviour: 'connected-only',
    policyCapability: 'connected-feature',
    reason: 'Uploading bytes is a connected job and is refused offline rather than silently retried as history.',
  }),

  'cloud-mcp-tool': row('cloud-mcp-tool', {
    surface: 'cloud-tool',
    behaviour: 'connected-only',
    policyCapability: 'external-mcp',
    reason: 'A cloud MCP tool runs only while connected and is never enqueued as offline history.',
  }),
  'mcp-management': row('mcp-management', {
    surface: 'cloud-tool',
    behaviour: 'connected-only',
    policyCapability: 'external-mcp',
    reason: 'Managing an MCP server is a connected account action and is refused offline.',
  }),
  'cloud-execution': row('cloud-execution', {
    surface: 'cloud-tool',
    behaviour: 'connected-only',
    policyCapability: 'connected-feature',
    reason: 'Cloud execution happens on the platform and is refused offline rather than replaced by a local run.',
  }),
  'gateway-inference': row('gateway-inference', {
    surface: 'cloud-tool',
    behaviour: 'connected-only',
    policyCapability: 'gateway-inference',
    reason: 'Gateway inference is a connected grant and is refused offline rather than used as a fallback.',
  }),

  'oauth-management': row('oauth-management', {
    surface: 'account',
    behaviour: 'connected-only',
    policyCapability: 'authenticate',
    reason: 'Managing an OAuth connection needs the platform and is refused offline.',
  }),
  'connected-feature': row('connected-feature', {
    surface: 'account',
    behaviour: 'connected-only',
    policyCapability: 'connected-feature',
    reason: 'An explicitly connected feature is unavailable while the platform is denied.',
  }),
  'remote-creation': row('remote-creation', {
    surface: 'account',
    behaviour: 'connected-only',
    policyCapability: 'synchronize',
    reason: 'Creating a remote record needs the platform and is refused offline instead of pretending it succeeded.',
  }),
  'approval-decision': row('approval-decision', {
    surface: 'account',
    behaviour: 'connected-only',
    policyCapability: 'synchronize',
    reason: 'Deciding a remote approval is a connected action and is refused offline rather than auto-accepted.',
  }),
  'server-summary': row('server-summary', {
    surface: 'remote-data',
    behaviour: 'local',
    freshness: 'cached-stale',
    reason: 'A server summary is read from the last synchronized snapshot and labelled as cached.',
  }),
  'remote-session-read': row('remote-session-read', {
    surface: 'remote-data',
    behaviour: 'local',
    freshness: 'cached-stale',
    reason: 'Remote session data is read from the local projection updated by delta sync.',
  }),
  'project-panel': row('project-panel', {
    surface: 'remote-data',
    behaviour: 'local',
    freshness: 'cached-stale',
    reason: 'A project panel renders the local snapshot with pending changes over the last sync.',
  }),

  'local-file-read': row('local-file-read', {
    surface: 'local-file',
    behaviour: 'local',
    reason: 'Reading a local file uses the host filesystem and contacts no platform.',
  }),
  'local-file-write': row('local-file-write', {
    surface: 'local-file',
    behaviour: 'local',
    reason: 'Writing a local file uses the host filesystem and contacts no platform.',
  }),
  'model-download': row('model-download', {
    surface: 'local-runtime',
    behaviour: 'connected-only',
    policyCapability: 'model-download',
    reason: 'Downloading a model needs a connection and is refused offline rather than started in the background.',
  }),
  'direct-provider': row('direct-provider', {
    surface: 'local-runtime',
    behaviour: 'connected-only',
    policyCapability: 'direct-provider',
    reason: 'A direct provider call leaves the device and is refused offline rather than queued as a chat turn.',
  }),
  'local-inference': row('local-inference', {
    surface: 'local-runtime',
    behaviour: 'local',
    reason: 'Local inference runs on the device and is the only inference available while gateway access is denied.',
  }),
  'synchronize': row('synchronize', {
    surface: 'account',
    behaviour: 'connected-only',
    policyCapability: 'synchronize',
    reason: 'Sending the sync batch needs the platform and is refused offline, which leaves the local queue intact.',
  }),

  'local-message-write': row('local-message-write', {
    surface: 'chat',
    behaviour: 'queued',
    policyCapability: 'synchronize',
    entityType: 'message',
    reason: 'A chat message is committed locally and a later sync batch replays it to the server.',
  }),
  'local-project-write': row('local-project-write', {
    surface: 'work',
    behaviour: 'queued',
    policyCapability: 'synchronize',
    entityType: 'project',
    reason: 'A local project is committed on the device and a later sync batch binds it to the server.',
  }),
  'local-ticket-write': row('local-ticket-write', {
    surface: 'work',
    behaviour: 'queued',
    policyCapability: 'synchronize',
    entityType: 'ticket',
    reason: 'A local ticket is committed on the device and a later sync batch replays its change.',
  }),
  'local-audit': row('local-audit', {
    surface: 'audit',
    behaviour: 'local',
    entityType: 'audit-run',
    reason: 'A local audit runs packaged definitions on the device and completes without a cloud audit.',
  }),
  'local-audit-finding': row('local-audit-finding', {
    surface: 'audit',
    behaviour: 'queued',
    policyCapability: 'synchronize',
    entityType: 'audit-finding',
    reason: 'A finding is stored locally and a later sync batch uploads it without rerunning the audit.',
  }),
  'local-remediation': row('local-remediation', {
    surface: 'audit',
    behaviour: 'queued',
    policyCapability: 'synchronize',
    entityType: 'remediation',
    reason: 'A remediation ticket is created locally and a later sync batch replays the creation once.',
  }),
  'local-memory-recall': row('local-memory-recall', {
    surface: 'memory',
    behaviour: 'local',
    reason: 'Memory recall reads the local snapshot and needs no platform request.',
  }),
  'local-fact-publish': row('local-fact-publish', {
    surface: 'memory',
    behaviour: 'queued',
    policyCapability: 'synchronize',
    entityType: 'memory-fact',
    reason: 'A fact is written locally with its provenance and a later sync batch publishes the changed facts.',
  }),

  'git-push': row('git-push', {
    surface: 'git',
    behaviour: 'connected-only',
    policyCapability: 'git-remote',
    reason: 'Pushing to a Git remote needs a connection and is refused offline rather than rewritten locally.',
  }),
});

const KNOWN: ReadonlySet<string> = new Set(HOST_CAPABILITIES);

const UNKNOWN_REASON = 'An unknown capability is refused and is never substituted with a server operation.';

function unknownRow(capability: string): CapabilityMatrixRow {
  return Object.freeze({
    capability,
    surface: null,
    behaviour: 'blocked',
    policyCapability: null,
    entityType: null,
    freshness: 'live',
    reason: UNKNOWN_REASON,
  });
}

export function isHostCapability(value: string): value is HostCapability {
  return KNOWN.has(value);
}

/**
 * The frozen row for a known capability. An unknown capability is blocked.
 * This function never throws and never performs or falls through to a call.
 */
export function offlineBehaviour(capability: string): CapabilityMatrixRow {
  if (isHostCapability(capability)) return CAPABILITY_MATRIX[capability];
  return unknownRow(capability);
}

/** The gate code a caller sees when a connected-only capability is refused. */
export const CAPABILITY_REQUIRES_CONNECTION = 'capability_requires_connection';

/** The gate code a caller sees when something that is not queueable is queued. */
export const CAPABILITY_NOT_QUEUEABLE = 'capability_not_queueable';

export class CapabilityRefusedError extends Error {
  readonly code = CAPABILITY_REQUIRES_CONNECTION;

  constructor(readonly capability: string, readonly reason: string) {
    super(`${CAPABILITY_REQUIRES_CONNECTION}:${capability}`);
    this.name = 'CapabilityRefusedError';
  }
}

export class CapabilityNotQueueableError extends Error {
  readonly code = CAPABILITY_NOT_QUEUEABLE;

  constructor(readonly capability: string, readonly behaviour: OfflineBehaviour, readonly reason: string) {
    super(`${CAPABILITY_NOT_QUEUEABLE}:${capability}`);
    this.name = 'CapabilityNotQueueableError';
  }
}

export interface CapabilityUseOptions {
  /** Whether the platform currently permits connected work. */
  readonly platformAllowed?: boolean;
}

export interface ResolvedCapability {
  readonly kind: Exclude<OfflineBehaviour, 'blocked'>;
  readonly row: CapabilityMatrixRow;
}

/**
 * Resolves a capability for use, refusing rather than dropping.
 *
 * `local` and `queued` resolve offline. `connected-only` resolves only while
 * the platform allows it and otherwise throws, so an unavailable remote action
 * is an explicit refusal instead of a silent no-op. An unknown capability is
 * refused as well.
 */
export function resolveCapability(capability: string, options: CapabilityUseOptions = {}): ResolvedCapability {
  const found = offlineBehaviour(capability);
  if (found.behaviour === 'blocked') throw new CapabilityRefusedError(capability, found.reason);
  if (found.behaviour === 'connected-only' && options.platformAllowed !== true) {
    throw new CapabilityRefusedError(capability, found.reason);
  }
  return Object.freeze({ kind: found.behaviour, row: found });
}

/**
 * Asserts that a capability may be used at all. This is the explicit
 * connected-only refusal: it throws instead of returning a falsy value that a
 * caller could drop on the floor.
 */
export function assertCapabilityAllowed(capability: string, options: CapabilityUseOptions = {}): void {
  resolveCapability(capability, options);
}

/** Every capability a later sync may replay. Nothing else is queueable. */
export const QUEUEABLE_CAPABILITIES: readonly HostCapability[] = Object.freeze(
  HOST_CAPABILITIES.filter((capability) => CAPABILITY_MATRIX[capability].behaviour === 'queued'),
);

const QUEUEABLE: ReadonlySet<string> = new Set(QUEUEABLE_CAPABILITIES);

/**
 * The durable local record a queued capability writes, for a queue that only
 * accepts classified local writes. Anything else, including an arbitrary MCP
 * call, throws instead of becoming offline history.
 */
export function assertQueueable(capability: string): CapabilityRecord {
  if (!QUEUEABLE.has(capability)) {
    const found = offlineBehaviour(capability);
    throw new CapabilityNotQueueableError(capability, found.behaviour, found.reason);
  }
  const entityType = CAPABILITY_MATRIX[capability as HostCapability].entityType;
  if (!entityType) {
    throw new CapabilityNotQueueableError(capability, 'queued', 'A queueable capability must name a durable local record.');
  }
  return entityType;
}

/** Every capability on a surface, in table order. */
export function capabilitiesForSurface(surface: CapabilitySurface): readonly HostCapability[] {
  return Object.freeze(
    HOST_CAPABILITIES.filter((capability) => CAPABILITY_MATRIX[capability].surface === surface),
  );
}

/**
 * The representative row for each platform policy capability, so the policy
 * gate and the matrix cannot drift: every capability is classified exactly
 * once here, and the record is exhaustive over `CapabilityPolicy`.
 */
export const POLICY_CAPABILITY_ROWS: Readonly<Record<CapabilityPolicy, HostCapability>> = Object.freeze({
  synchronize: 'synchronize',
  'gateway-inference': 'gateway-inference',
  'connected-feature': 'connected-feature',
  authenticate: 'oauth-management',
  'model-download': 'model-download',
  'direct-provider': 'direct-provider',
  'external-mcp': 'cloud-mcp-tool',
  'git-remote': 'git-push',
});

export function rowForPolicyCapability(capability: CapabilityPolicy): CapabilityMatrixRow {
  return CAPABILITY_MATRIX[POLICY_CAPABILITY_ROWS[capability]];
}