/**
 * Capability apps (PRD 33 §4.2 step 8) — DATA: the marketplace capabilities that
 * open as an app at `/apps/<id>` once a workspace installs their listing.
 *
 * The app's React component is bound beside it in
 * `components/marketplace/capability/capabilityAppComponents.ts`, not here: the
 * workspace rail (`InstalledAppsNav`) reads this list on every page, and binding
 * the component in the same module would pull the whole Insights app into the
 * rail's bundle. `lib/` also does not reach into `components/`.
 */

export interface CapabilityAppDef {
  /** The marketplace listing that grants it (and the `capabilityState` slug). */
  listingSlug: string;
  /** Where its home lives. */
  homePath: string;
  /** Its set-up flow, reached from the landing's "Start free". */
  setupPath: string;
  /** The intent "Start free" carries through sign-up (`resumeIntent`). */
  intent: string;
  /** The app's name, under the `apps` namespace (`apps.<nameKey>.name`). */
  nameKey: string;
}

export const CAPABILITY_APPS = {
  insights: {
    listingSlug: 'session-replay',
    homePath: '/apps/insights',
    setupPath: '/apps/insights/setup',
    intent: 'install:insights',
    nameKey: 'insights',
  },
} as const satisfies Record<string, CapabilityAppDef>;

export type CapabilityAppId = keyof typeof CAPABILITY_APPS;

export function capabilityAppFor(id: string): (CapabilityAppDef & { id: CapabilityAppId }) | null {
  if (!Object.prototype.hasOwnProperty.call(CAPABILITY_APPS, id)) return null;
  const appId = id as CapabilityAppId;
  return { id: appId, ...CAPABILITY_APPS[appId] };
}

/** The installed apps among `acquiredSlugs` (listing slugs from `GET /acquired`), in registry order. */
export function installedCapabilityApps(acquiredSlugs: Iterable<string>): Array<CapabilityAppDef & { id: CapabilityAppId }> {
  const held = new Set(acquiredSlugs);
  return (Object.keys(CAPABILITY_APPS) as CapabilityAppId[])
    .filter((id) => held.has(CAPABILITY_APPS[id].listingSlug))
    .map((id) => ({ id, ...CAPABILITY_APPS[id] }));
}

/** The app a capability listing opens as, by its listing slug — null for any other listing. */
export function capabilityAppForListing(listingSlug: string): (CapabilityAppDef & { id: CapabilityAppId }) | null {
  const id = (Object.keys(CAPABILITY_APPS) as CapabilityAppId[]).find((key) => CAPABILITY_APPS[key].listingSlug === listingSlug);
  return id ? { id, ...CAPABILITY_APPS[id] } : null;
}

/** Where "Get" goes for a capability app: its set-up page, through sign-up when signed out. */
export function capabilityStartHref(app: Pick<CapabilityAppDef, 'setupPath' | 'intent'>, signedIn: boolean, register: (next: string, intent: string) => string): string {
  return signedIn ? app.setupPath : register(app.setupPath, app.intent);
}

/** The listing page a non-customer is sent to. */
export function capabilityListingHref(app: Pick<CapabilityAppDef, 'listingSlug'>): string {
  return `/marketplace/listing/${app.listingSlug}`;
}
