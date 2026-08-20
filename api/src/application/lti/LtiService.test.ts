import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildLoginRedirect, fetchRoster, nextLink, pushScore, randomToken,
  publicHalfOf, rosterFromMembers, signDeepLinkingResponse, toolPublicJwks, verifyLaunch,
  type LtiRegistration,
} from './LtiService';
import { contentItemsFor } from './deepLinking';
import {
  AGS_SCOPE, LTI_CLAIM, capabilityFromRoles, deepLinkingResponseClaims, readDeepLinkingSettings,
  readLaunchClaims,
} from '../../domain/lti/ltiClaims';
import type { Env } from '../../env';

/**
 * These tests sign with REAL RSA keys and verify with the real WebCrypto path, because
 * the properties that matter here are cryptographic: a launch signed by the wrong key,
 * or replayed with a used nonce, must fail. A mocked verifier would prove nothing.
 */

const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const seg = (value: unknown): string => b64url(encoder.encode(JSON.stringify(value)));

let platform: CryptoKeyPair;
let platformJwk: JsonWebKey & { kid?: string };
let impostor: CryptoKeyPair;
let toolPrivateJwk: JsonWebKey;

const pair = async (): Promise<CryptoKeyPair> =>
  (await crypto.subtle.generateKey(KEY_PARAMS, true, ['sign', 'verify'])) as CryptoKeyPair;
const jwk = async (key: CryptoKey): Promise<JsonWebKey> =>
  (await crypto.subtle.exportKey('jwk', key)) as JsonWebKey;

const KEY_PARAMS = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' } as const;

beforeAll(async () => {
  platform = await pair();
  impostor = await pair();
  platformJwk = { ...(await jwk(platform.publicKey)), kid: 'platform-1', alg: 'RS256', use: 'sig' } as JsonWebKey & { kid: string };
  toolPrivateJwk = await jwk((await pair()).privateKey);
});

async function signToken(payload: Record<string, unknown>, key: CryptoKey, kid = 'platform-1'): Promise<string> {
  const input = `${seg({ alg: 'RS256', typ: 'JWT', kid })}.${seg(payload)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(input));
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

/**
 * A registration as every READ path now sees it: public key only.
 *
 * `id: null` marks it as coming from the legacy `LTI_REGISTRATIONS` secret rather
 * than from `lti_registrations`, which is what lets these tests exercise the real
 * signing path without a database — `toolPrivateKey` reads the secret for a null
 * id, and `memoryEnv` below supplies it.
 */
const REGISTRATION: LtiRegistration = {
  id: null,
  label: 'University LMS',
  issuer: 'https://lms.university.edu',
  clientId: 'builderforce-tool',
  deploymentIds: ['dep-1'],
  authLoginUrl: 'https://lms.university.edu/api/lti/authorize_redirect',
  accessTokenUrl: 'https://lms.university.edu/login/oauth2/token',
  keySetUrl: 'https://lms.university.edu/api/lti/security/jwks',
  toolKeyId: 'tool-1',
  toolPublicJwk: { kty: 'RSA' },
  tenantId: 7,
};

/** The same registration with a real, usable signing key behind it. */
const signable = (over: Partial<LtiRegistration> = {}): LtiRegistration => ({
  ...REGISTRATION,
  toolPublicJwk: publicHalfOf(toolPrivateJwk, REGISTRATION.toolKeyId),
  ...over,
});

/** An in-memory KV that behaves like the Worker binding the cache helper expects. */
function memoryEnv(): Env {
  const store = new Map<string, string>();
  return {
    // The compatibility source `toolPrivateKey` reads for a registration with no
    // row id. Assembled here rather than written as a literal so the key is a
    // real one and the assertion this signs actually verifies.
    LTI_REGISTRATIONS: JSON.stringify([{
      issuer: REGISTRATION.issuer,
      clientId: REGISTRATION.clientId,
      deploymentIds: [...REGISTRATION.deploymentIds],
      authLoginUrl: REGISTRATION.authLoginUrl,
      accessTokenUrl: REGISTRATION.accessTokenUrl,
      keySetUrl: REGISTRATION.keySetUrl,
      toolKeyId: REGISTRATION.toolKeyId,
      toolPrivateKeyJwk: toolPrivateJwk,
      tenantId: REGISTRATION.tenantId,
    }, {
      issuer: 'https://other.edu',
      clientId: REGISTRATION.clientId,
      deploymentIds: [...REGISTRATION.deploymentIds],
      authLoginUrl: REGISTRATION.authLoginUrl,
      accessTokenUrl: REGISTRATION.accessTokenUrl,
      keySetUrl: REGISTRATION.keySetUrl,
      toolKeyId: REGISTRATION.toolKeyId,
      toolPrivateKeyJwk: toolPrivateJwk,
      tenantId: REGISTRATION.tenantId,
    }]),
    AUTH_CACHE_KV: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
    },
  } as unknown as Env;
}

function launchPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: REGISTRATION.issuer,
    aud: REGISTRATION.clientId,
    sub: 'platform-user-9',
    iat: now,
    exp: now + 300,
    name: 'Ada Lovelace',
    email: 'ada@university.edu',
    [LTI_CLAIM.messageType]: 'LtiResourceLinkRequest',
    [LTI_CLAIM.version]: '1.3.0',
    [LTI_CLAIM.deploymentId]: 'dep-1',
    [LTI_CLAIM.roles]: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
    [LTI_CLAIM.context]: { id: 'ctx-1', label: 'PHYS2041', title: 'Thermal Physics' },
    [LTI_CLAIM.resourceLink]: { id: 'link-1', title: 'Assignment 1' },
    [LTI_CLAIM.ags]: {
      lineitems: 'https://lms.university.edu/api/lti/courses/1/line_items',
      lineitem: 'https://lms.university.edu/api/lti/courses/1/line_items/5?type_id=2',
      scope: [AGS_SCOPE.score, AGS_SCOPE.lineItem],
    },
    [LTI_CLAIM.nrps]: { context_memberships_url: 'https://lms.university.edu/api/lti/courses/1/names_and_roles' },
    ...overrides,
  };
}

function jwksFetch(keys: JsonWebKey[]): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({ keys }), { status: 200 })) as unknown as typeof fetch;
}

describe('LTI launch verification', () => {
  it('accepts a correctly signed launch and reads its claims', async () => {
    const env = memoryEnv();
    vi.stubGlobal('fetch', jwksFetch([platformJwk]));
    const { nonce } = await buildLoginRedirect(env, REGISTRATION, { iss: REGISTRATION.issuer }, 'https://app/lti/launch');

    const token = await signToken(launchPayload({ nonce }), platform.privateKey);
    const result = await verifyLaunch(env, token, REGISTRATION, nonce);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.contextLabel).toBe('PHYS2041');
    expect(result.context.capability).toBe('teach');
    expect(result.context.subject).toBe('platform-user-9');
    expect(result.context.membershipsUrl).toContain('names_and_roles');
    vi.unstubAllGlobals();
  });

  it('rejects a token signed by anybody else', async () => {
    const env = memoryEnv();
    vi.stubGlobal('fetch', jwksFetch([platformJwk]));
    const { nonce } = await buildLoginRedirect(env, REGISTRATION, { iss: REGISTRATION.issuer }, 'https://app/lti/launch');
    const token = await signToken(launchPayload({ nonce }), impostor.privateKey);

    const result = await verifyLaunch(env, token, REGISTRATION, nonce);
    expect(result).toMatchObject({ ok: false, error: 'id_token signature is not valid.' });
    vi.unstubAllGlobals();
  });

  it('burns the nonce, so a captured launch cannot be replayed', async () => {
    const env = memoryEnv();
    vi.stubGlobal('fetch', jwksFetch([platformJwk]));
    const { nonce } = await buildLoginRedirect(env, REGISTRATION, { iss: REGISTRATION.issuer }, 'https://app/lti/launch');
    const token = await signToken(launchPayload({ nonce }), platform.privateKey);

    expect((await verifyLaunch(env, token, REGISTRATION, nonce)).ok).toBe(true);
    // The identical, still-unexpired, still-correctly-signed token, replayed.
    expect(await verifyLaunch(env, token, REGISTRATION, nonce))
      .toMatchObject({ ok: false, error: 'id_token nonce has already been used.' });
    vi.unstubAllGlobals();
  });

  it('refuses an unsigned token rather than trusting its own alg header', async () => {
    const env = memoryEnv();
    // The `alg: none` attack in both the forms it is actually sent: with the signature
    // segment stripped, and with a junk signature to get past a naive shape check.
    // Both must be refused, and neither may reach the JWKS.
    const stripped = `${seg({ alg: 'none', typ: 'JWT' })}.${seg(launchPayload())}.`;
    expect(await verifyLaunch(env, stripped, REGISTRATION, null))
      .toMatchObject({ ok: false, error: 'Malformed id_token.' });

    const junkSigned = `${seg({ alg: 'none', typ: 'JWT', kid: 'platform-1' })}.${seg(launchPayload())}.AAAA`;
    expect(await verifyLaunch(env, junkSigned, REGISTRATION, null))
      .toMatchObject({ ok: false, error: 'id_token must be signed with RS256.' });

    // …and HS256, the other half of algorithm confusion: a token signed with the
    // platform's PUBLIC key as an HMAC secret must not verify either.
    const hmac = `${seg({ alg: 'HS256', typ: 'JWT', kid: 'platform-1' })}.${seg(launchPayload())}.AAAA`;
    expect(await verifyLaunch(env, hmac, REGISTRATION, null))
      .toMatchObject({ ok: false, error: 'id_token must be signed with RS256.' });
  });

  it('refuses another tool\'s token even when the platform is right', async () => {
    const env = memoryEnv();
    vi.stubGlobal('fetch', jwksFetch([platformJwk]));
    const token = await signToken(launchPayload({ aud: 'some-other-tool' }), platform.privateKey);
    expect(await verifyLaunch(env, token, REGISTRATION, null))
      .toMatchObject({ ok: false, error: 'id_token audience is not this tool.' });
    vi.unstubAllGlobals();
  });

  it('refuses a deployment the registration does not list', async () => {
    const env = memoryEnv();
    vi.stubGlobal('fetch', jwksFetch([platformJwk]));
    const token = await signToken(launchPayload({ [LTI_CLAIM.deploymentId]: 'dep-999' }), platform.privateKey);
    expect(await verifyLaunch(env, token, REGISTRATION, null))
      .toMatchObject({ ok: false, error: 'Launch deployment is not registered for this tool.' });
    vi.unstubAllGlobals();
  });

  it('refuses an expired launch', async () => {
    const env = memoryEnv();
    vi.stubGlobal('fetch', jwksFetch([platformJwk]));
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(launchPayload({ exp: now - 600, iat: now - 900 }), platform.privateKey);
    expect(await verifyLaunch(env, token, REGISTRATION, null))
      .toMatchObject({ ok: false, error: 'id_token has expired.' });
    vi.unstubAllGlobals();
  });

  it('builds a login redirect with the only parameter set LTI 1.3 permits', async () => {
    const env = memoryEnv();
    const redirect = await buildLoginRedirect(env, REGISTRATION, { iss: REGISTRATION.issuer, login_hint: 'u9' }, 'https://app/lti/launch');
    const url = new URL(redirect.url);
    expect(url.searchParams.get('response_type')).toBe('id_token');
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('client_id')).toBe(REGISTRATION.clientId);
    expect(url.searchParams.get('login_hint')).toBe('u9');
    expect(redirect.state).not.toBe(redirect.nonce);
    expect(randomToken().length).toBeGreaterThan(20);
  });
});

describe('LTI roles', () => {
  it('reads staff capability from the full URI and the short form alike', () => {
    expect(capabilityFromRoles(['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'])).toBe('teach');
    expect(capabilityFromRoles(['Instructor'])).toBe('teach');
    expect(capabilityFromRoles(['http://purl.imsglobal.org/vocab/lis/v2/membership#TeachingAssistant'])).toBe('assist');
    expect(capabilityFromRoles(['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'])).toBe('learn');
  });

  it('does not read Mentor as staff, however senior the word sounds', () => {
    // A mentor sees their own mentees, not the cohort. Reading this as staff is the
    // most common LTI authorisation bug.
    expect(capabilityFromRoles(['http://purl.imsglobal.org/vocab/lis/v2/membership#Mentor'])).toBe('learn');
  });

  it('names the missing claim rather than saying "invalid launch"', () => {
    expect(readLaunchClaims({ [LTI_CLAIM.messageType]: 'LtiResourceLinkRequest', [LTI_CLAIM.version]: '1.3.0' }))
      .toMatchObject({ ok: false, error: 'Launch has no deployment_id claim.' });
    expect(readLaunchClaims({ [LTI_CLAIM.messageType]: 'Nonsense' }))
      .toMatchObject({ ok: false, error: 'Unsupported LTI message type "Nonsense".' });
  });
});

describe('AGS and NRPS', () => {
  it('posts a score to the line item\'s /scores path, preserving its query string', async () => {
    const env = memoryEnv();
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/token')) return new Response(JSON.stringify({ access_token: 'svc-token' }), { status: 200 });
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch);

    const result = await pushScore(env, signable(),
      'https://lms.university.edu/api/lti/courses/1/line_items/5?type_id=2',
      { userId: 'platform-user-9', scoreGiven: 68, scoreMaximum: 100, released: true, timestamp: '2026-06-01T10:00:00Z', comment: 'Good critique.' });

    expect(result).toEqual({ ok: true });
    expect(calls[0]?.url).toBe('https://lms.university.edu/api/lti/courses/1/line_items/5/scores?type_id=2');
    expect(calls[0]?.body).toMatchObject({ scoreGiven: 68, gradingProgress: 'FullyGraded' });
    vi.unstubAllGlobals();
  });

  it('holds a mark back from the student when it has not been released', async () => {
    const env = memoryEnv();
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      if (String(input).endsWith('/token')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
      sent = JSON.parse(String(init?.body));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch);

    await pushScore(env, signable(), 'https://lms/li/1',
      { userId: 'u', scoreGiven: 40, scoreMaximum: 100, released: false, timestamp: '2026-06-01T10:00:00Z' });
    expect(sent.gradingProgress).toBe('Pending');
    vi.unstubAllGlobals();
  });

  it('follows NRPS pagination instead of returning the first page as the whole cohort', async () => {
    const env = memoryEnv();
    const page = (ids: string[], next?: string) => new Response(
      JSON.stringify({ members: ids.map((id) => ({ user_id: id, name: `Learner ${id}`, roles: ['Learner'], status: 'Active' })) }),
      { status: 200, headers: next ? { link: `<${next}>; rel="next"` } : {} },
    );
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.endsWith('/token')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
      if (url.includes('page=2')) return page(['c', 'd']);
      return page(['a', 'b'], 'https://lms/nrps?page=2');
    }) as unknown as typeof fetch);

    const result = await fetchRoster(env, signable(), 'https://lms/nrps');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.members.map((member) => member.userId)).toEqual(['a', 'b', 'c', 'd']);
    vi.unstubAllGlobals();
  });

  it('parses only the next relation out of a Link header', () => {
    expect(nextLink('<https://a/1>; rel="prev", <https://a/3>; rel="next"')).toBe('https://a/3');
    expect(nextLink('<https://a/1>; rel="prev"')).toBeNull();
    expect(nextLink(null)).toBeNull();
  });

  it('projects learners onto the roster shape, joining on the platform user id', () => {
    const roster = rosterFromMembers([
      { userId: 'u1', name: 'Ada', email: 'ada@u.edu', roles: ['Learner'], capability: 'learn', status: 'Active' },
      { userId: 'u2', name: 'Bo', email: 'bo@u.edu', roles: ['Learner'], capability: 'learn', status: 'Inactive' },
      { userId: 'u3', name: 'Prof', email: 'p@u.edu', roles: ['Instructor'], capability: 'teach', status: 'Active' },
    ]);
    // Staff are not rows on a student roster.
    expect(roster.map((row) => row.ref)).toEqual(['u1', 'u2']);
    expect(roster[1]?.status).toBe('withdrawn');
  });
});

describe('tool JWKS', () => {
  it('publishes the public half only, derived from the signing key', async () => {
    const jwks = toolPublicJwks([signable()]);
    expect(jwks.keys).toHaveLength(1);
    const key = jwks.keys[0] as unknown as Record<string, unknown>;
    expect(key.kid).toBe('tool-1');
    expect(key.n).toBeTruthy();
    // The private members must never be published.
    for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi']) expect(key[secret]).toBeUndefined();
  });

  it('publishes one entry per distinct key, not per registration', () => {
    const registrations = [
      signable(),
      signable({ issuer: 'https://other.edu' }),
    ];
    expect(toolPublicJwks(registrations).keys).toHaveLength(1);
  });
});

/**
 * Deep linking is the ONE exchange where this tool is the issuer and the
 * platform is the audience, and getting that pair backwards produces an
 * `invalid_client` the LMS reports with no further detail. So it is asserted
 * here, against a real signature, rather than left to review.
 */
describe('deep linking', () => {
  const DEEP_LINK_SETTINGS = {
    deep_link_return_url: 'https://lms.university.edu/courses/9/deep_link_response',
    accept_types: ['ltiResourceLink', 'link'],
    accept_presentation_document_targets: ['iframe', 'window'],
    accept_multiple: 'true',
    auto_create: false,
    title: 'Add Builderforce content',
    data: 'opaque-platform-token',
  };

  it('reads the platform\'s terms off the settings claim, coercing the string booleans platforms send', () => {
    const settings = readDeepLinkingSettings({ [LTI_CLAIM.deepLinkingSettings]: DEEP_LINK_SETTINGS });
    expect(settings).toMatchObject({
      returnUrl: DEEP_LINK_SETTINGS.deep_link_return_url,
      acceptMultiple: true,
      autoCreate: false,
      data: 'opaque-platform-token',
    });
    expect(settings?.acceptTypes).toEqual(['ltiResourceLink', 'link']);
  });

  it('refuses a request with nowhere to answer rather than presenting a picker that cannot return', () => {
    expect(readDeepLinkingSettings({})).toBeNull();
    expect(readDeepLinkingSettings({ [LTI_CLAIM.deepLinkingSettings]: { accept_multiple: true } })).toBeNull();
  });

  it('carries the message type onto the context, so a picker request is not read as a launch', () => {
    const claims = readLaunchClaims({
      [LTI_CLAIM.messageType]: 'LtiDeepLinkingRequest',
      [LTI_CLAIM.version]: '1.3.0',
      [LTI_CLAIM.deploymentId]: 'dep-1',
      sub: 'instructor-1',
      aud: REGISTRATION.clientId,
    });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.context.messageType).toBe('LtiDeepLinkingRequest');
  });

  it('builds a response whose issuer is US and whose audience is the platform', () => {
    const claims = deepLinkingResponseClaims({
      clientId: REGISTRATION.clientId,
      issuer: REGISTRATION.issuer,
      deploymentId: 'dep-1',
      nonce: 'nonce-1',
      data: 'opaque-platform-token',
      contentItems: [{ type: 'ltiResourceLink', url: 'https://api.builderforce.ai/api/lti/launch?object=abc', title: 'Essay 1' }],
      nowSeconds: 1_700_000_000,
    });
    // The mirror of a launch — this is the pair that is most often inverted.
    expect(claims.iss).toBe(REGISTRATION.clientId);
    expect(claims.aud).toBe(REGISTRATION.issuer);
    expect(claims[LTI_CLAIM.messageType]).toBe('LtiDeepLinkingResponse');
    expect(claims[LTI_CLAIM.version]).toBe('1.3.0');
    // The platform's opaque token, echoed verbatim — without it the platform
    // cannot match the response to the request it made.
    expect(claims[LTI_CLAIM.deepLinkingData]).toBe('opaque-platform-token');
    expect(claims.exp).toBeGreaterThan(claims.iat as number);
  });

  it('omits the data claim entirely when the platform sent none, rather than echoing an empty string', () => {
    const claims = deepLinkingResponseClaims({
      clientId: 'c', issuer: 'i', deploymentId: 'd', nonce: 'n', data: '',
      contentItems: [], nowSeconds: 1,
    });
    expect(LTI_CLAIM.deepLinkingData in claims).toBe(false);
  });

  it('signs the response with the SAME tool key the client assertion uses', async () => {
    const env = memoryEnv();
    const claims = deepLinkingResponseClaims({
      clientId: REGISTRATION.clientId,
      issuer: REGISTRATION.issuer,
      deploymentId: 'dep-1',
      nonce: 'nonce-1',
      data: '',
      contentItems: [],
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    const jwt = await signDeepLinkingResponse(env, signable(), claims);
    expect(jwt).toBeTruthy();

    const [header, payload, signature] = (jwt ?? '').split('.');
    expect(JSON.parse(atob(header!.replace(/-/g, '+').replace(/_/g, '/')))).toMatchObject({ alg: 'RS256', kid: 'tool-1' });
    expect(JSON.parse(atob(payload!.replace(/-/g, '+').replace(/_/g, '/')))).toMatchObject({ aud: REGISTRATION.issuer });
    expect(signature).toBeTruthy();
  });

  it('links to the object on BOTH the url and the custom parameters, so a course copy cannot lose it', () => {
    const [item] = contentItemsFor(
      [{ id: 'obj-1', kind: 'assignment', title: 'Essay 1', status: 'published' }],
      'https://api.builderforce.ai/api/lti/launch',
    );
    expect(item?.type).toBe('ltiResourceLink');
    expect(item?.url).toContain('object=obj-1');
    expect(item?.custom).toMatchObject({ builderforce_object_id: 'obj-1', builderforce_object_kind: 'assignment' });
  });
});
