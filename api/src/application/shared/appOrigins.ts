/**
 * THE WEB APP'S OWN ORIGINS — one list, shared by CORS (`presentation/middleware/cors.ts`),
 * the sign-in return origin and every checkout return URL (`trustedReturnUrl`).
 *
 * Lives under `application/shared` so use cases can name "which pages are the app"
 * without importing from the presentation layer; `cors.ts` re-exports `appOrigins`.
 */

export const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];

export const DEFAULT_APP_ORIGIN = 'https://builderforce.ai';

/**
 * First-party apps served beside the main app, one label down from it:
 * `studio.builderforce.ai` is the standalone IDE. Derived from each configured
 * apex rather than listed in config, so adding the app needs no secret change
 * and a staging apex gets its own studio automatically.
 */
const APP_SUBDOMAINS = ['studio'] as const;

function withAppSubdomains(origin: string): string[] {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.hostname.split('.').length !== 2) return [origin];
    return [origin, ...APP_SUBDOMAINS.map((label) => `https://${label}.${url.hostname}`)];
  } catch {
    return [origin];
  }
}

/**
 * The web app's own origins: the configured `CORS_ORIGINS` list, the first-party
 * apps beside each apex, and local dev. For where the APP must be named rather
 * than any caller, such as the `frame-ancestors` of a page only the app may
 * embed, or where a sign-in or a checkout may return to. A `*` entry is dropped,
 * since "any origin" is never a valid answer to "which page is the app".
 */
export function appOrigins(corsOrigins: string | undefined, includeDev = true): string[] {
  const configured = (corsOrigins ?? DEFAULT_APP_ORIGIN).split(',').map((s) => s.trim()).filter((s) => s && s !== '*');
  const apexes = configured.length ? configured : [DEFAULT_APP_ORIGIN];
  return [...new Set([...apexes.flatMap(withAppSubdomains), ...(includeDev ? DEV_ORIGINS : [])])];
}

/** True for the local development environments (`ENVIRONMENT=development|local`, as in `.dev.vars`). */
export function isDevEnvironment(environment: string | undefined): boolean {
  return environment === 'development' || environment === 'local';
}
