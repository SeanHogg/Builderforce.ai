'use client';

/**
 * Career tools for a LOGGED-OUT Creation Canvas turn.
 *
 * An authed canvas gets `builtin_recruiter_*`, `builtin_hr_*` and `builtin_listing_*`
 * from the tenant MCP catalog. A guest has no tenant, so it got nothing — and the
 * visitor most likely to arrive logged-out and type their whole situation into the first
 * box they see is someone out of work. Without these, the canvas answers "score my
 * résumé" out of the model's weights: a confident number that moves every time you ask,
 * which is the same failure the research surface was built to stop one domain over.
 *
 * ── WHY THE LIST IS FETCHED AND NOT WRITTEN HERE ─────────────────────────────────
 * The server catalog owns each tool's description and parameter schema. Re-typing
 * twenty-three of them in the browser is exactly the two-hand-written-lists defect
 * `packages/creation-canvas-contract/src/canvasTools.ts` exists to document: the copies
 * drift, the model is handed a schema the dispatcher does not accept, and the failure is
 * silent. So this module asks `GET /api/guest/career/tools` what it may call and builds
 * the action list from the answer.
 *
 * The NAMES are deliberately identical to the MCP-advertised ones, for the same reason
 * the research actions' are: one system prompt drives both surfaces, so a guest-only
 * alias would make the prompt name a tool absent from the guest's list — which fails by
 * the model narrating a call it cannot make while the turn "succeeds".
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { apiRequestStream } from './apiClient';
import { getStoredGuestToken } from './guestChatApi';
import { ensureGuestToken } from './guestRoomApi';
import { guestLimitFromBody, noteGuestLimit } from './guestLimit';

interface GuestCareerToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * One authorized career call. Returns the tool RESULT the model should see — errors
 * included — because a tool that throws costs the turn, while a tool that returns
 * `{ error }` lets the model say what happened and carry on. The domain's own refusals
 * ("paste your résumé first") arrive through this path and are exactly what the model
 * should relay.
 */
async function callCareerTool(name: string, args: unknown): Promise<unknown> {
  const token = (await ensureGuestToken()) ?? getStoredGuestToken();
  if (!token) return { error: 'Career tools are unavailable in this session. Sign up free to keep going.' };
  try {
    const res = await apiRequestStream(`/api/guest/career/${encodeURIComponent(name)}`, {
      auth: 'none',
      method: 'POST',
      body: JSON.stringify(args ?? {}),
      headers: { Authorization: `Bearer ${token}` },
      expectedErrors: [400, 401, 403, 404, 429, 503],
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      // A spent allowance is a guest wall like any other and never reaches the surface
      // as a thrown error — it is handed back as a tool result so the turn survives.
      // Announce it so the canvas can offer the free account the message is about.
      const refusal = guestLimitFromBody(data);
      if (refusal) noteGuestLimit(refusal);
      return { error: typeof data.error === 'string' ? data.error : `The career tool failed (${res.status}).` };
    }
    return data;
  } catch {
    return { error: 'The career tool could not be reached.' };
  }
}

/**
 * Cached across calls: the catalogue is static metadata and a canvas re-renders often.
 * A failed fetch is cached as an empty list ONLY for the current attempt — the promise
 * is cleared so the next turn retries rather than permanently losing the tools to one
 * bad network moment.
 */
let cached: Promise<BrainAction[]> | null = null;

/** The guest canvas's career toolset, resolved from the server catalog. */
export function loadGuestCareerActions(): Promise<BrainAction[]> {
  if (cached) return cached;
  cached = (async () => {
    try {
      const res = await apiRequestStream('/api/guest/career/tools', { auth: 'none', expectedErrors: [404, 503] });
      if (!res.ok) { cached = null; return []; }
      const body = (await res.json()) as { tools?: GuestCareerToolSpec[] };
      const tools = Array.isArray(body.tools) ? body.tools : [];
      if (!tools.length) { cached = null; return []; }
      return tools.map((spec): BrainAction => ({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters as BrainAction['parameters'],
        run: (raw: unknown) => callCareerTool(spec.name, raw),
      }));
    } catch {
      cached = null;
      return [];
    }
  })();
  return cached;
}
