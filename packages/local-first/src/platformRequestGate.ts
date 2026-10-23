/**
 * THE request gate's DECISION — whether ONE request to the platform may leave, for every
 * host (the web app's API client and sockets, the VS Code host's global fetch, its chat
 * webview's realm, Rovr's worker and panel fetch). Each host still decides which ORIGINS
 * are the platform and enforces/records; what a path means is the shared route table
 * (`classifyPlatformRequest` / `isContentRequest`), and whether it may go is THIS.
 *
 * Before this lived here, the web decided one way (`webApiRequestRefusal`) and the editor
 * and Rovr another (`policy.allows(capability)` on the raw class), so the SAME signed-in
 * Hybrid run was let through on the web and refused in the editor: an agent's ticket
 * write (`POST /api/...`, the `synchronize` default for a write) failed with
 * `platform_synchronize_disabled` because sync was off. One function, one answer.
 *
 *   - Not the platform, or `authenticate` (signing in / up, the session): never refused
 *     here — signing in is the explicit, scoped act that leaves Local only.
 *   - LOCAL ONLY: nothing that carries the person's CONTENT leaves — a prompt (gateway
 *     inference, the Brain stream), a memory, the personality block, a transcript, an
 *     upload, an error report, the sync transport's records (the table's `content` tag) —
 *     anonymous or credentialed alike. Ordinary data (a list, a setting) goes through.
 *   - HYBRID / SPECIFIC: inference and connected features as the policy allows them (an
 *     advanced override can still refuse one). An ordinary account write is NOT the
 *     local-first `synchronize` capability — that governs the sync transport, which
 *     asserts it itself (`createSyncCoordinator`) and is the only path the table NAMES as
 *     `synchronize` (`/api/sync`), held to the switch here too. A default write goes.
 *
 * Pure — no storage, no host.
 */
import type { InferenceMode } from './inferenceMode.js';
import { createPlatformPolicy, type PlatformCapability, type PlatformPolicySnapshot } from './policy.js';
import { classifyPlatformRequest, isContentRequest } from './platformRoutes.js';

/** Where the person stands: the mode in force and the snapshot it derived. */
export interface PlatformRequestStance {
  mode: InferenceMode;
  snapshot: Readonly<PlatformPolicySnapshot>;
}

/** A platform request as the gate reads it: the API path (mount removed) and its verb. */
export interface PlatformRequestShape {
  pathname: string;
  method?: string;
}

/**
 * The capability that refuses this platform request, or null when it may go. The caller
 * has already decided the URL is the platform's (its origin set).
 */
export function platformRequestRefusal(request: PlatformRequestShape, stance: PlatformRequestStance): PlatformCapability | null {
  const method = (request.method ?? 'GET').toUpperCase();
  const capability = classifyPlatformRequest(request.pathname, method);
  if (capability === 'authenticate') return null;
  if (stance.mode === 'local-only') {
    return capability === 'gateway-inference' || isContentRequest(request.pathname, method) ? capability : null;
  }
  // A write the table names nothing for defaults to `synchronize`; only a path the table
  // NAMES as sync (a GET there is still sync) is the sync transport the switch governs.
  if (capability === 'synchronize' && classifyPlatformRequest(request.pathname, 'GET') !== 'synchronize') return null;
  return createPlatformPolicy(stance.snapshot).allows(capability) ? null : capability;
}

