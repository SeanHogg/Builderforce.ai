/**
 * The logged-out canvas's research tools.
 *
 * Three things are load-bearing and none of them are visible at the call site:
 *   1. The NAMES must equal the MCP-advertised ones, because a single canvas system
 *      prompt names these tools for both surfaces AND the gateway's guest allowlist
 *      filters on exactly these strings. A rename here fails SILENTLY — the model
 *      narrates a call it cannot make and the turn "succeeds".
 *   2. Every call carries a guest token, and no token means a refusal rather than an
 *      unauthenticated request.
 *   3. A failure comes back as a RESULT (`{ error }`), never a throw: a throwing tool
 *      costs the whole turn, while a returned error lets the model say what happened
 *      and keep building from what the user gave it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequestStream: vi.fn(),
  ensureGuestToken: vi.fn(async () => 'bfguest_token' as string | null),
  getStoredGuestToken: vi.fn(() => 'bfguest_token' as string | null),
}));

vi.mock('./apiClient', () => ({ apiRequestStream: mocks.apiRequestStream }));
vi.mock('./guestRoomApi', () => ({ ensureGuestToken: mocks.ensureGuestToken }));
vi.mock('./guestChatApi', () => ({ getStoredGuestToken: mocks.getStoredGuestToken }));

const { GUEST_RESEARCH_ACTIONS } = await import('./guestResearchActions');

const action = (name: string) => GUEST_RESEARCH_ACTIONS.find((a) => a.name === name)!;

/** A stand-in for the fetch Response `apiRequestStream` returns. */
const response = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

beforeEach(() => {
  mocks.apiRequestStream.mockReset();
  mocks.ensureGuestToken.mockResolvedValue('bfguest_token');
  mocks.getStoredGuestToken.mockReturnValue('bfguest_token');
});
afterEach(() => { vi.clearAllMocks(); });

describe('tool names', () => {
  it('match the MCP-advertised names the canvas prompt and guest allowlist both use', () => {
    expect(GUEST_RESEARCH_ACTIONS.map((a) => a.name))
      .toEqual(['builtin_web_search', 'builtin_web_fetch', 'builtin_geo_geocode']);
  });

  it('are all read-only, so none of them trips the confirm-before-mutate gate', () => {
    for (const a of GUEST_RESEARCH_ACTIONS) expect(a.mutates).toBeUndefined();
  });
});

describe('builtin_web_search', () => {
  it('posts the query with the guest token and returns the vendor result verbatim', async () => {
    const result = { ok: true, query: 'ev makers', results: [{ url: 'https://example.com' }], coverage: 'encyclopedic' };
    mocks.apiRequestStream.mockResolvedValue(response(result));

    expect(await action('builtin_web_search').run({ query: 'ev makers' })).toEqual(result);

    const [path, init] = mocks.apiRequestStream.mock.calls[0]!;
    expect(path).toBe('/api/guest/research/search');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ query: 'ev makers' });
    expect(init.headers.Authorization).toBe('Bearer bfguest_token');
  });

  it('relays the server refusal as a result the model can explain (spent allowance)', async () => {
    mocks.apiRequestStream.mockResolvedValue(response(
      { error: "You've used your 40 free research lookups for today. Sign up free to keep going." },
      false, 429,
    ));
    expect(await action('builtin_web_search').run({ query: 'anything' }))
      .toEqual({ error: "You've used your 40 free research lookups for today. Sign up free to keep going." });
  });

  it('refuses without a guest token instead of calling the API unauthenticated', async () => {
    mocks.ensureGuestToken.mockResolvedValue(null);
    mocks.getStoredGuestToken.mockReturnValue(null);
    expect(await action('builtin_web_search').run({ query: 'x' })).toMatchObject({ error: expect.stringContaining('unavailable') });
    expect(mocks.apiRequestStream).not.toHaveBeenCalled();
  });

  it('returns an error result rather than throwing when the transport fails', async () => {
    mocks.apiRequestStream.mockRejectedValue(new Error('network down'));
    expect(await action('builtin_web_search').run({ query: 'x' })).toMatchObject({ error: expect.any(String) });
  });
});

describe('builtin_geo_geocode', () => {
  it('forwards the whole list plus the optional biasing options', async () => {
    mocks.apiRequestStream.mockResolvedValue(response({ results: [], resolved: 0, unresolved: 0, pending: 0 }));

    await action('builtin_geo_geocode').run({
      queries: ['Ann Arbor', '  Detroit  ', ''], context: ' Michigan, USA ', countryCodes: 'US', outline: true,
    });

    expect(JSON.parse(mocks.apiRequestStream.mock.calls[0]![1].body)).toEqual({
      queries: ['Ann Arbor', 'Detroit'], context: 'Michigan, USA', countryCodes: 'US', outline: true,
    });
  });

  it('refuses an empty list without a round trip', async () => {
    expect(await action('builtin_geo_geocode').run({ queries: [] })).toMatchObject({ error: expect.any(String) });
    expect(mocks.apiRequestStream).not.toHaveBeenCalled();
  });
});
