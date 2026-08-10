'use client';

/**
 * Research tools for a LOGGED-OUT Creation Canvas turn.
 *
 * An authed canvas gets `builtin_web_search` / `builtin_web_fetch` /
 * `builtin_geo_geocode` from the tenant MCP catalog. A guest has no tenant, so it got
 * nothing — and a canvas that cannot look anything up answers "research the top 10 X
 * and chart it" from the model's weights, which is how an anonymous visitor's very
 * first turn ended in a confident chart full of invented numbers.
 *
 * These actions restore the same three capabilities over the public guest research
 * surface (`/api/guest/research/*`), which owns the guard rails: the signed guest token
 * as the credential, its own daily call allowance, the PLATFORM search backing (never a
 * tenant's key), and the same SSRF-guarded fetch every other surface uses.
 *
 * The NAMES are deliberately identical to the MCP-advertised ones. One system prompt
 * (`creationCanvasAi.ts`) drives both surfaces and names these tools explicitly; a
 * guest-only alias would mean the prompt names a tool that appears nowhere in the
 * guest's tool list, which fails silently — the model narrates the call it cannot make
 * and the turn "succeeds". Keep them in lockstep with `advertisedName()` on the server
 * and with `GUEST_CANVAS_TOOL_NAMES`, which is what lets them through the gateway.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { apiRequestStream } from './apiClient';
import { getStoredGuestToken } from './guestChatApi';
import { ensureGuestToken } from './guestRoomApi';

/**
 * One authorized research call. Returns the tool RESULT the model should see — errors
 * included — because a research tool that throws costs the turn, while a research tool
 * that returns `{ error }` lets the model say what happened and carry on with what the
 * user gave it.
 */
async function research(path: string, body: unknown): Promise<unknown> {
  const token = (await ensureGuestToken()) ?? getStoredGuestToken();
  if (!token) return { error: 'Research is unavailable in this session. Sign up free to keep going.' };
  try {
    const res = await apiRequestStream(`/api/guest/research/${path}`, {
      auth: 'none',
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}` },
      expectedErrors: [400, 401, 429, 503],
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) return { error: typeof data.error === 'string' ? data.error : `Research request failed (${res.status}).` };
    return data;
  } catch {
    return { error: 'The research request could not be completed.' };
  }
}

/**
 * The guest canvas's research toolset. A module constant, not a factory: these close
 * over nothing but the stored guest token, so a stable identity keeps the memoized
 * action list in `CreationCanvas` from changing on every render.
 */
export const GUEST_RESEARCH_ACTIONS: BrainAction[] = [
  {
    name: 'builtin_web_search',
    description: 'Search the public web and return ranked results ({ title, url, snippet }) plus `coverage` and `attribution`. Use this FIRST when the user asks you to research a subject, find sources, or collect facts you do not already hold — then read the promising results with builtin_web_fetch and build the artifact from what you actually read. Do not answer a research request from memory. When `coverage` is "encyclopedic" the index is narrower than a full web engine: cite what you found and say so plainly rather than filling the gaps yourself.',
    parameters: {
      type: 'object', required: ['query'], additionalProperties: false,
      properties: { query: { type: 'string', description: 'What to search for, phrased as a search engine query.' } },
    },
    run: (raw: unknown) => research('search', { query: String((raw as { query?: unknown })?.query ?? '') }),
  },
  {
    name: 'builtin_web_fetch',
    description: 'Read an external URL and return its readable text content (HTML is stripped to prose). Use this on the sources builtin_web_search returned, or on any link the user pastes, before making claims about what they contain. Returns { url, title, text, truncated }.',
    parameters: {
      type: 'object', required: ['url'], additionalProperties: false,
      properties: { url: { type: 'string', description: 'Absolute http(s) URL to read.' } },
    },
    run: (raw: unknown) => research('fetch', { url: String((raw as { url?: unknown })?.url ?? '') }),
  },
  {
    name: 'builtin_geo_geocode',
    description: 'Convert place names (cities, counties, districts, schools, addresses, regions) into latitude/longitude coordinates plus a bounding box. Use this to turn a dataset of place names into something a Map object can plot: pass the name column values, then write the returned lat/lng back onto the dataset rows. Pass the WHOLE list in one call — do not pre-chunk it. Set outline:true for ONE enclosing region (e.g. "Michigan") to also get a simplified boundary polygon for the map background. Returns { results: [{ query, ok, lat, lng, displayName, boundingBox, kind }], resolved, unresolved, pending, truncated, attribution }. If "pending" is greater than 0, some names ran out of time budget rather than failing: call this tool AGAIN with the same list — everything already resolved is cached and returns instantly, so each call gets further. "unresolved" rows are different: those are names the geocoder does not recognise, and re-calling will not change them — re-spell them or add context instead.',
    parameters: {
      type: 'object', required: ['queries'], additionalProperties: false,
      properties: {
        queries: { type: 'array', items: { type: 'string' }, description: 'Place names to resolve. Pass them all at once.' },
        context: { type: 'string', description: 'Region appended to every term to disambiguate, e.g. "Michigan, USA".' },
        countryCodes: { type: 'string', description: 'ISO-3166 alpha-2 filter, e.g. "us".' },
        outline: { type: 'boolean', description: 'Also return a simplified boundary polygon. Use for a single enclosing region, not for every point.' },
      },
    },
    run: (raw: unknown) => {
      const args = raw as { queries?: unknown; context?: unknown; countryCodes?: unknown; outline?: unknown };
      const queries = Array.isArray(args.queries)
        ? args.queries.map((v) => String(v ?? '').trim()).filter(Boolean)
        : [];
      if (!queries.length) return Promise.resolve({ error: 'At least one place name is required.' });
      return research('geocode', {
        queries,
        ...(typeof args.context === 'string' && args.context.trim() ? { context: args.context.trim() } : {}),
        ...(typeof args.countryCodes === 'string' && args.countryCodes.trim() ? { countryCodes: args.countryCodes.trim() } : {}),
        ...(args.outline === true ? { outline: true } : {}),
      });
    },
  },
];
