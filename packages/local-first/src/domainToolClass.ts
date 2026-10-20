/**
 * Domain tool classification (G06).
 *
 * A pure table. Supported domain tools may run as local adapters. A server
 * MCP tool, and the named connected actions, are refused and are never
 * queued as offline history. Anything else is unknown and is not enqueued.
 * This module imports nothing and writes nothing.
 */

export type DomainToolMode = 'local' | 'connected-only' | 'unknown';

export interface DomainToolClass {
  readonly mode: DomainToolMode;
}

/**
 * Local adapters. These are domain writes and reads the device can perform.
 * They are not a replay of a fetched server MCP call.
 */
export const LOCAL_DOMAIN_TOOL_NAMES = Object.freeze([
  'project-create',
  'project-update',
  'project-move',
  'project-archive',
  'ticket-create',
  'ticket-update',
  'ticket-move',
  'ticket-archive',
  'memory-recall',
  'local-memory-recall',
  'audit-finding',
  'local-audit-finding',
] as const);

export type LocalDomainToolName = (typeof LOCAL_DOMAIN_TOOL_NAMES)[number];

/** Named actions that need the platform. Refused offline, never queued. */
export const CONNECTED_ONLY_DOMAIN_TOOL_NAMES = Object.freeze([
  'cloud-execution',
  'meeting-join',
  'remote-session-read',
] as const);

export type ConnectedOnlyDomainToolName = (typeof CONNECTED_ONLY_DOMAIN_TOOL_NAMES)[number];

const LOCAL: ReadonlySet<string> = new Set(LOCAL_DOMAIN_TOOL_NAMES);
const CONNECTED: ReadonlySet<string> = new Set(CONNECTED_ONLY_DOMAIN_TOOL_NAMES);

const LOCAL_CLASS: DomainToolClass = Object.freeze({ mode: 'local' });
const CONNECTED_CLASS: DomainToolClass = Object.freeze({ mode: 'connected-only' });
const UNKNOWN_CLASS: DomainToolClass = Object.freeze({ mode: 'unknown' });

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}

/**
 * A dynamically fetched server MCP tool. The gateway relay advertises flat
 * names such as `builtin_tasks_create`, and any name containing "mcp" is a
 * server tool. Neither is a local adapter and neither may be queued.
 */
export function looksLikeServerMcpTool(name: string): boolean {
  if (typeof name !== 'string') return false;
  const raw = name.trim().toLowerCase();
  if (raw.includes('mcp')) return true;
  return normalize(name).startsWith('builtin-');
}

/**
 * Classify a domain tool name. Local adapters may run offline. A server MCP
 * tool, cloud execution, meeting join, and remote session read are
 * connected-only. Every other name is unknown.
 */
export function classifyDomainTool(name: string): DomainToolClass {
  if (typeof name !== 'string') return UNKNOWN_CLASS;
  if (looksLikeServerMcpTool(name)) return CONNECTED_CLASS;
  const normalized = normalize(name);
  if (normalized === '' || normalized === '-') return UNKNOWN_CLASS;
  if (LOCAL.has(normalized)) return LOCAL_CLASS;
  if (CONNECTED.has(normalized)) return CONNECTED_CLASS;
  return UNKNOWN_CLASS;
}

/** True only for a local adapter. Connected-only and unknown are not queued. */
export function mayEnqueueOffline(name: string): boolean {
  return classifyDomainTool(name).mode === 'local';
}
