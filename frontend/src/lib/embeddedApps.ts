/**
 * EMBEDDED APPS, CLIENT SIDE — the transport and the derivations behind
 * "this board is a project now, and here is what you own".
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * The server half of conversion has been live and CALLED BY NOTHING:
 *
 *   POST /api/creation-sessions/:id/convert-to-app     make this board an app
 *   GET  /api/creation-sessions/address-available      is this address free?
 *   GET  /api/creation-sessions/:id                    now answers with `app`
 *
 * A component never embeds a query, so every one of those reads lives here as a
 * typed client and the two surfaces under `components/apps/` call functions
 * rather than URLs.
 *
 * ── WHAT IS DELIBERATELY *NOT* HERE ──────────────────────────────────────────
 * The project overview COMPOSES clients that already exist — `fetchSite`
 * (`lib/api.ts`), `siteDomainApi` / `siteDataApi` / `siteTrafficApi`
 * (`lib/growthApi.ts`). Re-declaring those endpoints to get four numbers is
 * exactly the duplication that lets two surfaces disagree about what a site is.
 * This module adds ONE thing on top of them: a single cached read that answers
 * "what does this app run on" in one await instead of four scattered effects.
 *
 * ── ADDRESS VALIDATION HAS NO CLIENT MIRROR, ON PURPOSE ──────────────────────
 * There is no local copy of `normalizeSubdomain` here. The server is the arbiter
 * of what a label becomes and whether it is free, and it RETURNS the normalised
 * label — so the field shows the reader the server's answer rather than a second
 * implementation's guess. A client-side normaliser is how "looks fine here"
 * becomes "rejected on submit".
 *
 * ── CACHING ──────────────────────────────────────────────────────────────────
 * Both reads go through the browser's canonical read-through cache
 * (`getOrSetClientCached`), which is single-flight and bounded — a panel that
 * mounts, unmounts and remounts as the reader opens and closes it must not fire
 * a request each time. Conversion invalidates both keyspaces, because it is the
 * one write that changes either answer.
 */

import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';
import { apiRequest } from './apiClient';
import { creationSessionsApi } from './builderforceApi';
import { fetchSite, type SiteInfo } from './api';
import {
  siteDataApi,
  siteDomainApi,
  siteTrafficApi,
  type CustomDomainState,
  type SiteCollection,
  type SiteTrafficSummary,
} from './growthApi';

// ---------------------------------------------------------------------------
// Vocabulary — mirrors `application/canvas/convertSessionToApp.ts`
// ---------------------------------------------------------------------------

/** The app a board became, as `GET /api/creation-sessions/:id` reports it. */
export interface SessionApp {
  projectId: number;
  projectKey: string;
  name: string;
  /** Null only if the address reservation failed; the first publish claims one. */
  subdomain: string | null;
}

/** What conversion answers with. `created` distinguishes a fresh app from a replay. */
export interface ConvertedApp {
  projectId: number;
  projectKey: string;
  name: string;
  sessionId: string;
  subdomain: string;
  host: string;
  created: boolean;
}

/** A reader's standing on a board. Mirrors the server's `SessionRole`. */
export type SessionRole = 'viewer' | 'commenter' | 'editor' | 'runner' | 'owner';

/**
 * What the convert surface needs to decide its own state, in one read.
 *
 * The ROLE rides along because the panel must not offer an action the server
 * will refuse: `POST convert-to-app` is editor+, and a viewer shown the button
 * learns that by pressing it.
 */
export interface SessionAppState {
  app: SessionApp | null;
  role: SessionRole;
  /** The board's title — the address falls back to it when nothing is typed. */
  title: string;
}

/**
 * MAY THIS READER CONVERT?
 *
 * One derivation of the server's `requireSession(c, 'editor')` rank check, so
 * the button and the endpoint cannot disagree about who gets to press it.
 */
const CONVERT_ROLES: ReadonlySet<SessionRole> = new Set<SessionRole>(['editor', 'runner', 'owner']);

export function canConvertSession(role: SessionRole): boolean {
  return CONVERT_ROLES.has(role);
}

/** Why an address is or is not usable. Mirrors `SubdomainAvailabilityReason`. */
export type AddressReason = 'ok' | 'invalid' | 'reserved' | 'taken';

export interface AddressAvailability {
  /** The normalised DNS label, or null when the input cannot become one. */
  label: string | null;
  available: boolean;
  reason: AddressReason;
  /** The full host the app would answer on, when the label is usable. */
  host: string | null;
}

/**
 * Everything the project panel STATES, in one value.
 *
 * Every field is nullable because each read fails independently: a project with
 * a reserved address but no traffic rollup yet is normal, not an error, and the
 * panel must render the parts it has rather than nothing.
 */
export interface AppOverview {
  site: SiteInfo | null;
  domain: CustomDomainState | null;
  collections: SiteCollection[];
  traffic: SiteTrafficSummary | null;
}

// ---------------------------------------------------------------------------
// Cache keys — one namespace per question, so conversion can invalidate both
// ---------------------------------------------------------------------------

const SESSION_APP_KEY = (sessionId: string) => `embedded-app:session:${sessionId}`;
const OVERVIEW_KEY = (projectId: number | string) => `embedded-app:overview:${projectId}`;
const ADDRESS_KEY = (projectId: number | string) => `embedded-app:address:${projectId}`;

/** A board is opened and closed constantly; the answer changes only on convert. */
const SESSION_APP_TTL_MS = 60_000;
/** Traffic and record counts move on their own, so this window is shorter. */
const OVERVIEW_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const SESSIONS = '/api/creation-sessions';

export const embeddedAppsApi = {
  /**
   * The app this board became (or null), plus who is asking.
   *
   * Reads through `creationSessionsApi.get` rather than restating the URL, so
   * there is ONE declaration of `GET /api/creation-sessions/:id` in the client.
   * That endpoint answers with the whole graph, which is more than this needs —
   * see the Gap Register entry for the narrow `/app` read that would replace it;
   * until then the cache above is what keeps it to one request per board.
   */
  sessionAppState: (sessionId: string): Promise<SessionAppState> =>
    getOrSetClientCached(
      SESSION_APP_KEY(sessionId),
      () => creationSessionsApi.get(sessionId).then((detail) => ({
        app: detail.app ?? null,
        role: detail.role,
        title: detail.session.title,
      })),
      { ttlMs: SESSION_APP_TTL_MS },
    ),

  /**
   * Is this address free?
   *
   * NOT cached, deliberately, and for the same reason the server refuses to
   * cache it: this is a live uniqueness question typed a character at a time,
   * and a cached "available" that survives somebody else claiming the name tells
   * the creator they have it and then fails the publish.
   */
  addressAvailable: (label: string): Promise<AddressAvailability> =>
    apiRequest<AddressAvailability>(
      `${SESSIONS}/address-available?label=${encodeURIComponent(label)}`,
      // An empty or unusable label answers 400; the field renders that inline
      // rather than raising the global fault toast.
      { expectedErrors: [400] },
    ),

  /**
   * Make this board an app. Idempotent server-side — a double click costs
   * nothing and returns the app that already exists.
   */
  convertToApp: async (sessionId: string, label?: string | null): Promise<ConvertedApp> => {
    const { app } = await apiRequest<{ app: ConvertedApp }>(
      `${SESSIONS}/${encodeURIComponent(sessionId)}/convert-to-app`,
      {
        method: 'POST',
        body: JSON.stringify({ label: label?.trim() || undefined }),
        // 400 unusable label · 404 not editable · 409 address taken. All three
        // are answers the panel renders beside the field, not system faults.
        expectedErrors: [400, 404, 409],
      },
    );
    invalidateApp({ sessionId, projectId: app.projectId });
    return app;
  },

  /**
   * WHERE ONE APP ANSWERS — nothing else.
   *
   * The session read reports a `subdomain` and cannot report the hosting apex,
   * so a board converted in an earlier visit knows its label and not its URL.
   * `SiteInfo.url` is built server-side from the apex, which is why this asks
   * for it rather than concatenating a constant the client would have to keep
   * in step with the deployment.
   *
   * Separate from `overview` deliberately: the canvas needs ONE address, and
   * making it pay for traffic, collections and domain state to get it is the
   * over-fetch this split exists to avoid.
   */
  appAddress: (projectId: number | string): Promise<string | null> =>
    getOrSetClientCached(
      ADDRESS_KEY(projectId),
      () => fetchSite(projectId).then((site) => site?.url ?? null).catch(() => null),
      { ttlMs: SESSION_APP_TTL_MS },
    ),

  /**
   * What this app runs on, in one await.
   *
   * The four reads are issued CONCURRENTLY — sequencing them would make the
   * panel's first paint the sum of four round-trips — and each is allowed to
   * fail alone. A project with no site answers `site: null`, which is how the
   * panel decides it has nothing to say and renders nothing.
   */
  overview: (projectId: number | string): Promise<AppOverview> =>
    getOrSetClientCached(
      OVERVIEW_KEY(projectId),
      async () => {
        const [site, domain, collections, traffic] = await Promise.all([
          fetchSite(projectId).catch(() => null),
          siteDomainApi.get(projectId).catch(() => null),
          siteDataApi.listCollections(projectId).then((r) => r.collections).catch(() => []),
          siteTrafficApi.get(projectId, 30).catch(() => null),
        ]);
        return { site, domain, collections, traffic } satisfies AppOverview;
      },
      { ttlMs: OVERVIEW_TTL_MS },
    ),
};

/** Drop the cached answers a conversion (or a publish) just changed. */
export function invalidateApp(scope: { sessionId?: string; projectId?: number | string }): void {
  if (scope.sessionId) invalidateClientCache(SESSION_APP_KEY(scope.sessionId));
  if (scope.projectId !== undefined) {
    invalidateClientCache(OVERVIEW_KEY(scope.projectId));
    invalidateClientCache(ADDRESS_KEY(scope.projectId));
  }
}

// ---------------------------------------------------------------------------
// Derivations — the STATEMENTS both surfaces make, derived once
// ---------------------------------------------------------------------------

/**
 * WHERE THE APP ANSWERS.
 *
 * `SiteInfo.url` is built server-side from the hosting apex, so the primary
 * address is never reconstructed here. The custom domain counts only once it is
 * genuinely reachable (`live`) — showing a hostname whose certificate is still
 * pending as "your address" is how somebody shares a link that 526s.
 */
export function appAddresses(overview: AppOverview): { primary: string | null; custom: string | null } {
  return {
    primary: overview.site?.url ?? null,
    custom: overview.domain?.live && overview.domain.hostname
      ? `https://${overview.domain.hostname}`
      : null,
  };
}

/**
 * IS ANYTHING ACTUALLY SERVED THERE?
 *
 * Conversion reserves the address with an EMPTY site row, so `site !== null`
 * does not mean published. The asset count is the honest discriminator, and it
 * is what separates "your address is held for you" from "your app is live".
 */
export function appIsPublished(overview: AppOverview): boolean {
  return (overview.site?.assetCount ?? 0) > 0;
}

/** What the data statement says. `gated` = collections only a signed-in person may write. */
export function appDataFacts(overview: AppOverview): {
  collections: number;
  records: number;
  gated: number;
} {
  return {
    collections: overview.collections.length,
    records: overview.collections.reduce((total, collection) => total + collection.recordCount, 0),
    gated: overview.collections.filter((collection) => collection.audienceId !== null).length,
  };
}

/**
 * What the people statement says.
 *
 * `approximate` is carried through rather than dropped: the counts are buffered
 * per isolate and the server says so, so the surface has to say so too.
 */
export function appPeopleFacts(overview: AppOverview): {
  visitors: number;
  pageViews: number;
  approximate: boolean;
} {
  return {
    visitors: overview.traffic?.totals.visitors ?? 0,
    pageViews: overview.traffic?.totals.pageViews ?? 0,
    approximate: overview.traffic?.approximate ?? true,
  };
}
