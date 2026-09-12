'use client';

/**
 * The CONNECT catalog client — `GET /api/integrations/connectable`.
 *
 * The server describes every provider a credential can be stored for (label,
 * gallery category, base-URL requirement, credential fields). The connect UI
 * renders ONLY from this: there is no provider table in the frontend. The
 * `PROVIDER_META` table this replaces covered 23 hand-picked providers, so the
 * gallery had no card — and the manager no form — for the other 24 the server
 * already accepted.
 *
 * Both registries here are static server constants, so each is fetched at most
 * once per session through the read-through client cache; every consumer shares
 * the same in-flight/resolved promise.
 */
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import { boardConnectionsApi, type BoardProviderMeta } from './builderforceApi';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';

/** One credential input. `key` is also the i18n id: `integrationCredentials.fields.<key>`. */
export interface CredentialFieldDescriptor {
  key: string;
  /** English fallback — the UI renders the translated `fields.<key>`. */
  label: string;
  secret: boolean;
  required: boolean;
  /** A format example (`ghp_…`, `postgres://…`) — rendered literally. */
  placeholder?: string;
}

export type BaseUrlRequirement = 'required' | 'optional' | 'none';

export interface ConnectableProvider {
  id: string;
  /** Brand name — rendered literally. */
  label: string;
  /** Gallery section — translated as `integrations.gallery.category.<category>`. */
  category: string;
  baseUrl: BaseUrlRequirement;
  credentialFields: CredentialFieldDescriptor[];
  /** `tcp` providers store + validate but cannot run from the cloud runtime. */
  transport: 'http' | 'tcp';
  family: string | null;
}

export interface ConnectableCatalog {
  providers: ConnectableProvider[];
  /** Gallery section order. */
  categories: string[];
}

/** An object (not bare functions) so tests can stub the transport. */
export const connectableCatalogApi = {
  fetch: (): Promise<ConnectableCatalog> =>
    apiRequest<Partial<ConnectableCatalog>>('/api/integrations/connectable').then((r) => ({
      providers: r.providers ?? [],
      categories: r.categories ?? [],
    })),
};

/** Shared prefix — `invalidateClientCache(INTEGRATION_CATALOG_CACHE_PREFIX)` drops both. */
export const INTEGRATION_CATALOG_CACHE_PREFIX = 'integrations:';

export function loadConnectableCatalog(): Promise<ConnectableCatalog> {
  return getOrSetClientCached(`${INTEGRATION_CATALOG_CACHE_PREFIX}connectable`, () => connectableCatalogApi.fetch());
}

/** The synced-board catalog (`GET /api/board-connections/providers`), cached the same way. */
export function loadBoardProviders(): Promise<BoardProviderMeta[]> {
  return getOrSetClientCached(`${INTEGRATION_CATALOG_CACHE_PREFIX}board-providers`, () => boardConnectionsApi.providers());
}

export interface UseConnectableCatalog {
  catalog: ConnectableCatalog | null;
  byId: ReadonlyMap<string, ConnectableProvider>;
  loading: boolean;
  failed: boolean;
}

export function useConnectableCatalog(): UseConnectableCatalog {
  const [state, setState] = useState<{ catalog: ConnectableCatalog | null; loading: boolean; failed: boolean }>({
    catalog: null,
    loading: true,
    failed: false,
  });

  useEffect(() => {
    let alive = true;
    loadConnectableCatalog()
      .then((catalog) => { if (alive) setState({ catalog, loading: false, failed: false }); })
      .catch(() => { if (alive) setState({ catalog: null, loading: false, failed: true }); });
    return () => { alive = false; };
  }, []);

  const byId = useMemo(
    () => new Map((state.catalog?.providers ?? []).map((provider) => [provider.id, provider])),
    [state.catalog],
  );
  return { ...state, byId };
}

/** The synced-board providers; empty until loaded (and on failure). */
export function useBoardProviders(): BoardProviderMeta[] {
  const [boards, setBoards] = useState<BoardProviderMeta[]>([]);
  useEffect(() => {
    let alive = true;
    loadBoardProviders()
      .then((list) => { if (alive) setBoards(list); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return boards;
}
