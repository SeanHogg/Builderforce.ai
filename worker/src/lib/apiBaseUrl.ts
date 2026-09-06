/**
 * Where the api lives, for every worker → api call.
 *
 * `BUILDERFORCE_API_BASE_URL` is a visible var in wrangler.toml so local/dev/prod
 * targets are explicit; the default is production. Lived privately in
 * `services/gateway.ts` until the session-introspection check needed the same
 * answer — one resolver, so the two calls can never point at different hosts.
 */
export interface ApiBaseEnv {
  BUILDERFORCE_API_BASE_URL?: string;
}

export function getApiBaseUrl(env: ApiBaseEnv): string {
  return (env.BUILDERFORCE_API_BASE_URL ?? 'https://api.builderforce.ai').replace(/\/$/, '');
}
