/**
 * THE client for institutional identity: enterprise SSO connections
 * (`/api/sso-connections/*`), the pre-session SSO discovery lookup
 * (`/api/auth/sso/discover`), LTI 1.3 platform registrations
 * (`/api/lti-registrations/*`) and the LTI deep-linking picker
 * (`/api/lti/deep-link/*`).
 *
 * Its own module because it is its own bounded surface: how an institution's
 * identity provider or LMS is wired to a workspace. No other client shares a
 * type with it, and it was split out of `builderforceApi.ts` to keep that file
 * under its architecture ceiling.
 *
 * Goes through `apiRequest`, which is THE transport — the header contract
 * (emulation token, locale, error dispatch) is load-bearing.
 */

import { apiRequest } from '@/lib/apiClient';

/** One SSO connection as a screen may see it: no client secret, ever. */
export interface SsoConnection {
  id: number;
  label: string;
  protocol: string;
  issuer: string;
  discoveryUrl: string | null;
  authorizationUrl: string | null;
  tokenUrl: string | null;
  jwksUrl: string | null;
  userinfoUrl: string | null;
  clientId: string;
  scopes: string;
  jitProvisioning: boolean;
  defaultRole: string;
  status: string;
  domains: Array<{ id: number; domain: string; verified: boolean; verifyToken: string }>;
}

export interface SsoConnectionInput {
  label: string;
  issuer: string;
  discoveryUrl?: string | null;
  authorizationUrl?: string | null;
  tokenUrl?: string | null;
  jwksUrl?: string | null;
  userinfoUrl?: string | null;
  clientId: string;
  /** Omit on edit to LEAVE the stored secret alone — the server treats empty as
   *  "unchanged" rather than "blank it", because a form that never receives a
   *  secret would otherwise erase it on every save. */
  clientSecret?: string;
  scopes?: string;
  jitProvisioning?: boolean;
  defaultRole?: string;
}

export const ssoConnectionsApi = {
  list: (): Promise<{ connections: SsoConnection[]; redirectUri: string }> =>
    apiRequest('/api/sso-connections'),

  create: (input: SsoConnectionInput): Promise<{ connection: SsoConnection }> =>
    apiRequest('/api/sso-connections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }),

  update: (id: number, input: SsoConnectionInput): Promise<{ connection: SsoConnection }> =>
    apiRequest(`/api/sso-connections/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }),

  remove: (id: number): Promise<void> =>
    apiRequest(`/api/sso-connections/${id}`, { method: 'DELETE' }).then(() => undefined),

  addDomain: (id: number, domain: string): Promise<{ domain: string; recordName: string; recordValue: string }> =>
    apiRequest(`/api/sso-connections/${id}/domains`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain }),
    }),

  verifyDomain: (domainId: number): Promise<{ verified: boolean; recordName: string; expected: string; found: string[] }> =>
    apiRequest(`/api/sso-connections/domains/${domainId}/verify`, { method: 'POST' }),

  removeDomain: (domainId: number): Promise<void> =>
    apiRequest(`/api/sso-connections/domains/${domainId}`, { method: 'DELETE' }).then(() => undefined),
};

/** One LTI platform registration. No key material — the private half is sealed
 *  server-side and no read path returns it. */
export interface LtiRegistration {
  id: number;
  label: string;
  issuer: string;
  clientId: string;
  deploymentIds: string[];
  authLoginUrl: string;
  accessTokenUrl: string;
  keySetUrl: string;
  toolKeyId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LtiRegistrationInput {
  label: string;
  issuer: string;
  clientId: string;
  deploymentIds: string[];
  authLoginUrl: string;
  accessTokenUrl: string;
  keySetUrl: string;
}

/** The URLs an administrator pastes back INTO their LMS. Served with the list so
 *  nobody has to type them from memory — a mistyped one fails with
 *  `invalid_client` and no further detail. */
export interface LtiToolUrls {
  oidcInitiationUrl: string;
  targetLinkUri: string;
  publicJwkUrl: string;
  configUrl: string;
}

export const ltiRegistrationsApi = {
  list: (): Promise<{ registrations: LtiRegistration[]; tool: LtiToolUrls }> =>
    apiRequest('/api/lti-registrations'),

  create: (input: LtiRegistrationInput): Promise<{ registration: LtiRegistration; publicJwk: Record<string, unknown> }> =>
    apiRequest('/api/lti-registrations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }),

  update: (id: number, input: LtiRegistrationInput): Promise<{ registration: LtiRegistration }> =>
    apiRequest(`/api/lti-registrations/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }),

  rotateKey: (id: number): Promise<{ registration: LtiRegistration; publicJwk: Record<string, unknown> }> =>
    apiRequest(`/api/lti-registrations/${id}/rotate-key`, { method: 'POST' }),

  disable: (id: number): Promise<{ registration: LtiRegistration }> =>
    apiRequest(`/api/lti-registrations/${id}/disable`, { method: 'POST' }),

  enable: (id: number): Promise<{ registration: LtiRegistration }> =>
    apiRequest(`/api/lti-registrations/${id}/enable`, { method: 'POST' }),
};

/** One thing on a course board an LMS may be handed a link to. The server's
 *  allow-list decides which kinds appear — a roster, a submission and a
 *  gradebook never do. */
export interface LtiLinkableObject {
  id: string;
  kind: string;
  title: string;
  status: string;
}

export interface LtiDeepLinkOptions {
  objects: LtiLinkableObject[];
  /** The PLATFORM's terms for this exchange, not our preferences: whether it
   *  will take more than one item, and what it suggests the picker say. */
  settings: { acceptMultiple: boolean; title: string; text: string };
}

/**
 * The LTI deep-linking picker — the LMS asking what to add to a course.
 *
 * `auth: 'none'` on both calls, deliberately. The picker renders inside the
 * LMS's content dialog, where our session cookie is a blocked third-party cookie
 * and the instructor may have no Builderforce session at all. The `token` IS the
 * credential: a short-lived, HMAC-signed envelope the verified launch minted,
 * naming the workspace and the course board it was minted for. Sending a tenant
 * JWT here would authorise the wrong thing — the person in the iframe, not the
 * launch that put them there.
 */
export const ltiDeepLinkApi = {
  options: (token: string): Promise<LtiDeepLinkOptions> =>
    apiRequest(`/api/lti/deep-link/options?token=${encodeURIComponent(token)}`, { auth: 'none' }),

  /** Sign the selection. Returns the platform's return URL and the response JWT
   *  for the page to form-POST — the browser has to make that request, because
   *  the platform's return endpoint authenticates the instructor's LMS session. */
  respond: (token: string, objectIds: string[]): Promise<{ returnUrl: string; jwt: string }> =>
    apiRequest('/api/lti/deep-link/response', {
      method: 'POST',
      auth: 'none',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, objectIds }),
    }),
};

/** Whether an email address signs in through an institution. Unauthenticated —
 *  it is called from the login page before there is a session. */
export const ssoDiscoveryApi = {
  discover: (email: string): Promise<{ sso: boolean; connectionId?: number; label?: string }> =>
    apiRequest(`/api/auth/sso/discover?email=${encodeURIComponent(email)}`),
};
