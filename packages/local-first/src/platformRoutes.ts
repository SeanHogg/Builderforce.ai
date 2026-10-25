/**
 * WHICH CAPABILITY a request to the platform exercises — THE route table every host's
 * guard reads (the VS Code host's global fetch, Rovr's worker and panel fetch, the web
 * app's local-first transport). Each host still decides which ORIGINS are the platform;
 * this decides what a platform path means, so one URL is the same capability everywhere.
 *
 * The method alone is not the answer. A POST is a write only when it changes something
 * the person owns: the personality/affect block, a memory recall, a search, the model
 * catalog and the editor's presence beat are POSTs that READ (or merely say "I am here"),
 * so they are connected features — classifying them as `synchronize` is what blocked a
 * signed-in Hybrid user's personality block and heartbeat while sync was off.
 *
 * Data, not code: a rule is a path shape and the capability it means. First match wins;
 * anything unmatched is a read when it is GET/HEAD and a write otherwise.
 *
 * CONTENT. Orthogonal to the capability, a rule may say the request CARRIES THE PERSON'S
 * CONTENT — a prompt, a transcript, a memory, an upload, the personality block, an error
 * report with what was on screen ({@link isContentRequest}). The web's Local only refuses
 * exactly those (and gateway inference), anonymous or credentialed alike, and lets the
 * page's ordinary data through; the VS Code and Rovr guards keep their stricter
 * per-capability rule and read the same table.
 */
import type { PlatformCapability } from './policy.js';

export interface PlatformRouteRule {
  /**
   * The path shape. `*` matches exactly one segment. `exact` (default) matches the
   * whole path; `suffix` its last segments; `contains` any run of segments.
   */
  path: string;
  match?: 'exact' | 'prefix' | 'suffix' | 'contains';
  /**
   * The capability the path means. Absent = the method's default (a read when GET/HEAD,
   * a write otherwise) — a rule that exists only to tag {@link content}.
   */
  capability?: PlatformCapability;
  /** The request carries the person's content (see the module comment). */
  content?: true;
  /** Why the rule exists — read by people, not code. */
  note: string;
}

export const PLATFORM_ROUTE_RULES: readonly PlatformRouteRule[] = Object.freeze([
  { path: '/api/auth', match: 'contains', capability: 'authenticate', note: 'token exchange and session' },
  { path: '/api/vscode/tenants/*/token', capability: 'authenticate', note: "the editor's tenant token exchange" },
  { path: '/chat/completions', match: 'contains', capability: 'gateway-inference', content: true, note: 'a gateway completion — the prompt' },
  { path: '/api/brain/stream', capability: 'gateway-inference', content: true, note: "the Brain's streamed turn — the prompt" },
  { path: '/llm/v1/models', capability: 'connected-feature', note: 'the model catalog' },
  { path: '/api/llm/models', capability: 'connected-feature', note: 'the model catalog' },
  { path: '/api/limbic/block', capability: 'connected-feature', content: true, note: "personality block — once per session; the per-turn affect is appraised on the device" },
  { path: '/api/limbic', match: 'prefix', capability: 'connected-feature', content: true, note: 'the personality / affect store' },
  { path: '/api/projects/*/evermind/recall', capability: 'connected-feature', content: true, note: 'memory recall — a read that sends the prompt' },
  { path: '/api/projects/*/evermind', match: 'contains', capability: 'connected-feature', content: true, note: "a project's Evermind memory" },
  { path: '/api/evermind', match: 'contains', capability: 'connected-feature', content: true, note: 'Evermind memory' },
  { path: '/api/sync', match: 'prefix', capability: 'synchronize', content: true, note: 'the local-first sync transport — the records themselves' },
  // PRD 36: a signed-in editor BINDS its local chat to a server chat so the chat's
  // tickets, usage and memory land on it. The bind sends a title and a project — never
  // the transcript (that is `/messages`, below, and the sync transport above).
  { path: '/api/brain/chats', capability: 'connected-feature', note: 'binding a chat to the account — its title and project only' },
  { path: '/api/brain/chats/*/messages', content: true, note: "a Brain chat's transcript" },
  { path: '/api/chats/*/messages', content: true, note: "a chat's transcript" },
  { path: '/api/brain/upload', content: true, note: 'an uploaded file' },
  { path: '/api/brain/fetch-url', content: true, note: 'a page fetched for the Brain — the URL the person gave' },
  { path: '/product-report', match: 'suffix', content: true, note: 'an error report — what was on screen' },
  // Sockets that carry the person's content (an upgrade is a GET, so these keep the
  // read default): live canvas sync, rooms and meetings, an execution's stream, an
  // agent host's chat. A socket that only says "something changed" is not tagged.
  { path: '/api/creation-sessions/*/ws', content: true, note: "a canvas session's live sync" },
  { path: '/api/guest/rooms/*/ws', content: true, note: "a guest room's shared transcript and meeting" },
  { path: '/api/agile/ceremonies/rooms/*/ws', content: true, note: "a ceremony room's live conversation" },
  { path: '/api/meetings/rooms/*/ws', content: true, note: "a meeting room's signalling" },
  { path: '/api/runtime/executions/*/stream', content: true, note: "an execution's live stream — messages, tool results, file changes" },
  { path: '/api/agent-hosts/*/ws', content: true, note: "an agent host's chat" },
  { path: '/api/guest/research', match: 'prefix', content: true, note: "a guest canvas's research call — the query" },
  { path: '/api/guest/career', match: 'prefix', content: true, note: "a guest canvas's career tool — the résumé / job text" },
  { path: '/search', match: 'suffix', capability: 'connected-feature', note: 'a search — a read' },
  { path: '/api/dashboards/query', capability: 'connected-feature', note: 'a dashboard query — a read' },
  { path: '/api/data-sources/*/query', capability: 'connected-feature', note: 'a data-source query — a read' },
  { path: '/api/vscode/connect', capability: 'connected-feature', note: 'the editor presence beat' },
] satisfies PlatformRouteRule[]);

const segments = (path: string): string[] => path.split('/').filter(Boolean);

function segmentsMatch(pattern: readonly string[], path: readonly string[], at: number): boolean {
  return pattern.every((part, i) => part === '*' || part === path[at + i]);
}

function ruleMatches(rule: PlatformRouteRule, path: readonly string[]): boolean {
  const pattern = segments(rule.path);
  if (pattern.length > path.length) return false;
  switch (rule.match ?? 'exact') {
    case 'exact':
      return pattern.length === path.length && segmentsMatch(pattern, path, 0);
    case 'prefix':
      return segmentsMatch(pattern, path, 0);
    case 'suffix':
      return segmentsMatch(pattern, path, path.length - pattern.length);
    case 'contains':
      for (let at = 0; at + pattern.length <= path.length; at += 1) if (segmentsMatch(pattern, path, at)) return true;
      return false;
  }
}

/** The capability a platform request needs, from its path and method. */
export function classifyPlatformRequest(
  pathname: string,
  method = 'GET',
  rules: readonly PlatformRouteRule[] = PLATFORM_ROUTE_RULES,
): PlatformCapability {
  const path = segments(pathname);
  const rule = rules.find((candidate) => candidate.capability && ruleMatches(candidate, path));
  if (rule?.capability) return rule.capability;
  const verb = method.toUpperCase();
  return verb === 'GET' || verb === 'HEAD' ? 'connected-feature' : 'synchronize';
}

/**
 * Whether a platform request carries the person's content — a prompt, a transcript, a
 * memory, an upload, an error report (any matching rule tagged `content`). The method
 * is accepted for symmetry with {@link classifyPlatformRequest}; today every content
 * path carries content whatever its verb (reading a transcript returns it).
 */
export function isContentRequest(
  pathname: string,
  _method = 'GET',
  rules: readonly PlatformRouteRule[] = PLATFORM_ROUTE_RULES,
): boolean {
  const path = segments(pathname);
  return rules.some((rule) => rule.content === true && ruleMatches(rule, path));
}

/** The method of a fetch call (`init` first, then a `Request`'s own), upper-cased. */
export function platformRequestMethod(input: string | URL | Request, init?: RequestInit): string {
  return (init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
}

/** The URL of a fetch call, whatever shape its input took. */
export function platformRequestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}
