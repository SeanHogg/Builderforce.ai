/**
 * The build stamp, on its own, with no imports.
 *
 * It lived in `appVersions.ts` and still reads identically from there — that
 * module re-exports this one, so there is still exactly ONE declaration of
 * `NEXT_PUBLIC_APP_VERSION` and no consumer had to change.
 *
 * It moved because the guest session store needs it and `appVersions.ts` cannot
 * be imported from there: it pulls in `apiClient`, and `apiClient` is what asks
 * the guest store whether a read should be served from the sample workspace. A
 * leaf module breaks that cycle without giving the env var a second home.
 */

/** Build-time UI version, or '—' when the build didn't stamp one. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '—';

/**
 * Embedded Brain (`@seanhogg/builderforce-brain-embedded`) that composed a canvas
 * or in-page turn. This is NOT the Agent Execution Engine's deploy stamp — that
 * engine is {@link AGENT_ENGINE} and ships inside the API build (`apiVersion`).
 */
export const BRAIN_VERSION = process.env.NEXT_PUBLIC_BRAIN_VERSION || '—';

/**
 * In-browser sandbox (`@seanhogg/builderforce-webcontainers`) the canvas build
 * commands run on. A `bfsh:` failure or a `preview.builderforce.ai/__bfwc/` URL
 * is a failure of this build.
 */
export const RUNTIME_VERSION = process.env.NEXT_PUBLIC_RUNTIME_VERSION || '—';

/**
 * The only Agent Execution Engine. It has no version of its own: the cloud loop
 * lives in the API worker, so its deploy stamp is `apiVersion`. A canvas Brain
 * turn does not run that loop — it runs the embedded Brain ({@link BRAIN_VERSION}).
 */
export const AGENT_ENGINE = 'builderforce-v3';
