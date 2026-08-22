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
