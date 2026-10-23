/**
 * Template read caching — version tokens per (tenant, kind) and per kind for the
 * public catalogue. Split out of `catalogTemplateStore.ts`: every store read goes
 * through {@link versionedRead}, and every store write calls
 * {@link bumpTemplateVersions}, so a write is visible on the next read without
 * enumerating the list / item / public keys it affected.
 */
import type { Env } from '../../env';
import {
  bumpCacheVersion,
  getCacheVersion,
  getOrSetCached,
} from '../../infrastructure/cache/readThroughCache';
import type { TemplateKind } from './templateKinds';

export const tenantTemplatesVersionKey = (tenantId: number, kind: TemplateKind): string =>
  `templates-version:tenant:${tenantId}:${kind}`;
export const publicTemplatesVersionKey = (kind: TemplateKind): string =>
  `templates-version:public:${kind}`;

/** Every version key a write of `kind` bumps: the tenant's own list plus the public catalogue. */
export function templateVersionKeysFor(tenantId: number | null, kind: TemplateKind): string[] {
  return [
    ...(tenantId === null ? [] : [tenantTemplatesVersionKey(tenantId, kind)]),
    publicTemplatesVersionKey(kind),
  ];
}

/** Templates change rarely and every write bumps the token; the TTL is the backstop. */
const TEMPLATE_CACHE = { kvTtlSeconds: 3_600, l1TtlMs: 60_000 };

/**
 * A read keyed by `versionKey`'s current token. Without an `env` (unit tests,
 * non-Worker callers) the loader runs directly — the same fall-through
 * `getOrSetCached` already gives a missing KV.
 */
export async function versionedRead<T>(
  env: Env | undefined,
  versionKey: string,
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  if (!env) return loader();
  // Short L1 on the token: a write in another isolate shows within seconds, not 30 s.
  const version = await getCacheVersion(env, versionKey, { l1TtlMs: 2_000 });
  return getOrSetCached(env, `${key}:v:${version}`, loader, TEMPLATE_CACHE);
}

/** Bump the tenant's and the public catalogue's tokens for `kind`. A publish
 *  changes what every workspace (and a signed-out visitor) sees, and a private
 *  edit is cheap to over-invalidate, so every write drops both. */
export async function bumpTemplateVersions(env: Env | undefined, tenantId: number | null, kind: TemplateKind): Promise<void> {
  if (!env) return;
  await Promise.all(templateVersionKeysFor(tenantId, kind).map((key) => bumpCacheVersion(env, key)));
}
