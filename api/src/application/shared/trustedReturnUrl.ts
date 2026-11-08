/**
 * WHERE A HOSTED CHECKOUT MAY SEND THE BUYER BACK TO.
 *
 * A checkout's success/cancel URLs are built from a `returnUrl` the caller names.
 * Taken at face value that is an open redirect on a page the processor hosts: a
 * crafted link makes a real checkout land the buyer (and the session id in the
 * query) on an attacker's site. So the origin must be one of the web app's own
 * (`appOrigins`, the same list CORS uses), or the request is refused with a 400.
 *
 * No `returnUrl` falls back to the web origin (never the API's), at `defaultPath`.
 * Only ORIGIN + PATH are returned for use: the query string and fragment of the
 * caller's value are dropped by every checkout builder.
 */
import { ValidationError } from '../../domain/shared/errors';
import { appOrigins, isDevEnvironment } from './appOrigins';

export interface ReturnUrlEnv {
  ENVIRONMENT?: string | undefined;
  CORS_ORIGINS?: string | undefined;
  APP_URL?: string | undefined;
}

const DEFAULT_WEB_ORIGIN = 'https://builderforce.ai';

function configuredWebOrigin(env: ReturnUrlEnv): string {
  const first = (env.APP_URL ?? DEFAULT_WEB_ORIGIN).split(',')[0]!.trim();
  try {
    return new URL(first).origin;
  } catch {
    return DEFAULT_WEB_ORIGIN;
  }
}

export function trustedReturnUrl(env: ReturnUrlEnv, raw: string | null | undefined, defaultPath = '/'): URL {
  const web = configuredWebOrigin(env);
  if (raw == null || raw.trim() === '') return new URL(defaultPath, web);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('returnUrl must be an absolute URL');
  }
  // localhost is a valid return target only in a development deployment; production refuses it.
  const allowed = new Set([web, ...appOrigins(env.CORS_ORIGINS, isDevEnvironment(env.ENVIRONMENT))]);
  if (!allowed.has(url.origin)) throw new ValidationError('returnUrl is not an allowed origin');
  return url;
}
