/**
 * "An account somebody connected" — the one implementation, shared by every port built
 * on `connector_connections`.
 *
 * Social accounts, ad accounts and analytics properties are three different nouns with
 * ONE storage model and one set of rules:
 *
 *   · the credential blob is sealed, and only NON-SECRET scope fields come back out;
 *   · an account missing a scope field is not `ready`, and says which field;
 *   · a caller naming a PLATFORM rather than a connection resolves when there is
 *     exactly one, and ASKS when there is more than one;
 *   · a connection's `updated_at` is the cache version, so correcting a wrong account
 *     id makes every cached read for it unreachable with no invalidation call.
 *
 * Those four rules were written three times before this file existed, which is three
 * places for "does this account have what it needs" to drift apart — and the drift is
 * invisible until someone publishes to the wrong page or spends on the wrong account.
 *
 * Each port keeps its own PUBLIC view shape (`network` vs `source`, `publishMode` vs
 * `objectives`): that vocabulary is the domain's, not this file's. What is shared is
 * the query, the decryption, the readiness computation and the resolution — the parts
 * that are genuinely identical.
 */

import { and, inArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { connectorConnections } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { credentialSecret, decryptCredentials } from './credentialCrypto';
import { executeConnectorAction } from '../connectors/connectorRuntime';

/** One non-secret value the connection must carry before the account is usable. */
export interface AccountFieldSpec {
  key: string;
  label: string;
  help: string;
  /**
   * A scope field that UNLOCKS something rather than gating everything.
   *
   * Meta's Page id is the case this exists for: an ad account can create, budget and
   * pause campaigns without one, and only needs it to author an ad's creative. Listing
   * it as required would mark every already-connected Meta account "not ready" the
   * moment ad-level support shipped — an existing, working connection reporting itself
   * broken because a NEW capability wants one more value. So it is declared, it is
   * reported in `missingFields` so a form can ask for it and an error can name it, and
   * it does not decide `ready`.
   */
  optional?: boolean;
}

/**
 * What this primitive needs to know about a port's provider. Ports declare more.
 *
 * There is deliberately no `id` field: each port already names its own identifier
 * (`network` for social and ads, `source` for analytics), and adding a second copy of
 * it just to satisfy this interface would be the duplication this file exists to
 * remove. The accessor is passed in instead.
 */
export interface AccountProvider {
  readonly label: string;
  readonly connectorKey: string;
  readonly accountFields: readonly AccountFieldSpec[];
}

export interface ConnectionRow {
  id: string;
  connectorKey: string;
  name: string;
  enabled: boolean;
  lastTestOk: boolean | null;
  lastUsedAt: Date | null;
  /** The cache version — see {@link cacheVersionOf}. */
  updatedAt: Date;
  credentialsEnc: string;
  iv: string;
}

/** The part of an account view that is the same on every port. */
export interface BaseAccountView {
  /** The connector connection id — the handle every other call takes. */
  id: string;
  name: string;
  enabled: boolean;
  /** False when a required scope field is still missing. */
  ready: boolean;
  missingFields: AccountFieldSpec[];
  lastTestOk: boolean | null;
  lastUsedAt: string | null;
}

export interface ResolvedAccount<P extends AccountProvider> {
  row: ConnectionRow;
  provider: P;
  /** The non-secret scope fields only. A token never appears here. */
  fields: Record<string, string>;
  base: BaseAccountView;
}

export type ResolveResult<P extends AccountProvider> =
  | { ok: true; account: ResolvedAccount<P> }
  | { ok: false; error: string };

/**
 * A connection's `updated_at`, as a cache version.
 *
 * Editing a connection — a corrected account id, a re-pasted token — changes the
 * version, so every cached read keyed with it is unreachable from the next request
 * onward. Without this, fixing a wrong id would leave the old answer cached and the
 * fix would look like it had not worked.
 */
export const cacheVersionOf = (row: { updatedAt: Date }): string => String(row.updatedAt.getTime());

export interface ConnectedAccountsPort<P extends AccountProvider> {
  /** Every connected account for the workspace, in creation order. */
  resolveAll(db: Db, env: Env, tenantId: number, connectionIds?: readonly string[]): Promise<ResolvedAccount<P>[]>;
  /** Only the accounts that could actually be used right now. */
  resolveUsable(db: Db, env: Env, tenantId: number, connectionIds?: readonly string[]): Promise<ResolvedAccount<P>[]>;
  /** Pick the one account a call means, or explain why it cannot. */
  resolveOne(
    db: Db, env: Env, tenantId: number,
    ref: { connectionId?: string | null; providerId?: string | null },
  ): Promise<ResolveResult<P>>;
  /** Bind one account to the connector runtime — the only way a port talks out. */
  callerFor(
    db: Db, env: Env, tenantId: number, account: ResolvedAccount<P>, actorKind: 'agent' | 'user',
  ): (actionKey: string, input?: Record<string, unknown>, opts?: { captureHeaders?: readonly string[] }) => Promise<{
    ok: boolean; status: number; data: unknown; error?: string; headers?: Record<string, string>;
  }>;
}

export function createConnectedAccountsPort<P extends AccountProvider>(config: {
  /** Every connector key this port owns, for one-query filters. */
  connectorKeys: readonly string[];
  providerForConnector: (connectorKey: string) => P | null;
  /** How this port names its provider — `(p) => p.network`, `(p) => p.source`. */
  providerId: (provider: P) => string;
  /** The noun used in the messages this port produces, e.g. `'ad account'`. */
  noun: string;
}): ConnectedAccountsPort<P> {
  const { connectorKeys, providerForConnector, providerId, noun } = config;

  async function loadRows(db: Db, tenantId: number, connectionIds?: readonly string[]): Promise<ConnectionRow[]> {
    return db
      .select({
        id: connectorConnections.id,
        connectorKey: connectorConnections.connectorKey,
        name: connectorConnections.name,
        enabled: connectorConnections.enabled,
        lastTestOk: connectorConnections.lastTestOk,
        lastUsedAt: connectorConnections.lastUsedAt,
        updatedAt: connectorConnections.updatedAt,
        credentialsEnc: connectorConnections.credentialsEnc,
        iv: connectorConnections.iv,
      })
      .from(connectorConnections)
      .where(scopedToTenant(
        connectorConnections,
        tenantId,
        connectionIds?.length
          ? and(inArray(connectorConnections.connectorKey, [...connectorKeys]), inArray(connectorConnections.id, [...connectionIds]))
          : inArray(connectorConnections.connectorKey, [...connectorKeys]),
      ))
      .orderBy(connectorConnections.createdAt);
  }

  /** Open the sealed blob and take ONLY the declared non-secret fields out of it. */
  async function scopeFields(env: Env, tenantId: number, row: ConnectionRow, provider: P): Promise<Record<string, string>> {
    if (provider.accountFields.length === 0) return {};
    const blob = await decryptCredentials(row.credentialsEnc, row.iv, credentialSecret(env), tenantId);
    const out: Record<string, string> = {};
    for (const field of provider.accountFields) {
      const value = blob?.[field.key];
      if (value != null && value !== '') out[field.key] = String(value);
    }
    return out;
  }

  function toBaseView(row: ConnectionRow, provider: P, fields: Record<string, string>): BaseAccountView {
    const missingFields = provider.accountFields.filter((f) => !fields[f.key]);
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      // `ready` means "can this account be SPENT on". An absent optional field narrows
      // what it can do; it does not make the account unusable, and reporting it as
      // unusable would be a working connection calling itself broken.
      ready: row.enabled && missingFields.every((f) => f.optional === true),
      missingFields,
      lastTestOk: row.lastTestOk,
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    };
  }

  async function resolveAll(db: Db, env: Env, tenantId: number, connectionIds?: readonly string[]): Promise<ResolvedAccount<P>[]> {
    const rows = await loadRows(db, tenantId, connectionIds);
    const resolved: ResolvedAccount<P>[] = [];
    for (const row of rows) {
      const provider = providerForConnector(row.connectorKey);
      // A connector key this port owns but has no adapter for is not an account.
      if (!provider) continue;
      const fields = await scopeFields(env, tenantId, row, provider);
      resolved.push({ row, provider, fields, base: toBaseView(row, provider, fields) });
    }
    return resolved;
  }

  async function resolveUsable(db: Db, env: Env, tenantId: number, connectionIds?: readonly string[]): Promise<ResolvedAccount<P>[]> {
    const all = await resolveAll(db, env, tenantId, connectionIds);
    return all.filter((a) => a.row.enabled && a.base.missingFields.length === 0);
  }

  /** A connection missing its scope field is unusable for every operation, so this is
   *  checked once rather than per call. */
  function checkReady(account: ResolvedAccount<P>): ResolveResult<P> {
    const missing = account.base.missingFields;
    if (missing.length > 0) {
      return {
        ok: false,
        error: `The ${account.provider.label} connection “${account.row.name}” is missing ${missing.map((f) => f.label).join(', ')}. Add it to the connection first.`,
      };
    }
    return { ok: true, account };
  }

  return {
    resolveAll,
    resolveUsable,

    async resolveOne(db, env, tenantId, ref) {
      const accounts = await resolveAll(db, env, tenantId, ref.connectionId ? [ref.connectionId] : undefined);
      const usable = accounts.filter((a) => a.row.enabled);

      if (ref.connectionId) {
        const found = usable.find((a) => a.row.id === ref.connectionId);
        if (!found) return { ok: false, error: `That ${noun} is not connected to this workspace, or has been disabled.` };
        return checkReady(found);
      }

      const scoped = ref.providerId ? usable.filter((a) => providerId(a.provider) === ref.providerId) : usable;
      if (scoped.length === 0) {
        return {
          ok: false,
          error: ref.providerId
            ? `No ${ref.providerId} ${noun} is connected to this workspace yet.`
            : `No ${noun}s are connected to this workspace yet.`,
        };
      }
      // Naming a platform with several accounts on it is genuinely ambiguous, and
      // guessing publishes to — or spends on — the wrong one.
      if (scoped.length > 1) {
        const names = scoped.map((a) => `${a.provider.label} · ${a.row.name}`).join(', ');
        return { ok: false, error: `Say which ${noun} to use: ${names}.` };
      }
      return checkReady(scoped[0]!);
    },

    callerFor(db, env, tenantId, account, actorKind) {
      return async (actionKey, input = {}, opts) => {
        const result = await executeConnectorAction({
          db, env, tenantId,
          connectorKey: account.provider.connectorKey,
          actionKey,
          input,
          connectionId: account.row.id,
          actorKind,
          ...(opts?.captureHeaders ? { captureHeaders: opts.captureHeaders } : {}),
        });
        return {
          ok: result.ok,
          status: result.status,
          data: result.data,
          ...(result.error ? { error: result.error } : {}),
          ...(result.headers ? { headers: result.headers } : {}),
        };
      };
    },
  };
}
