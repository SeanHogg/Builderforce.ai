// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useEffect, useState } from 'react';
import { siteUsersApi, type SiteUser, type SiteUserStatus } from '@/lib/growthApi';

const PAGE = 50;

export interface SiteUsers {
  /** Null until the first page answers. */
  users: SiteUser[] | null;
  hasMore: boolean;
  loadError: unknown;
  loadMore: () => Promise<void>;
  setStatus: (userId: number, status: SiteUserStatus) => Promise<void>;
  remove: (userId: number) => Promise<void>;
}

/** The people signed up to a project's app, a page at a time. Mutations throw to the caller. */
export function useSiteUsers(projectId: number): SiteUsers {
  const [users, setUsers] = useState<SiteUser[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    siteUsersApi.list(projectId, PAGE)
      .then(({ users: page }) => {
        if (cancelled) return;
        setUsers(page);
        setHasMore(page.length === PAGE);
      })
      .catch((cause: unknown) => { if (!cancelled) setLoadError(cause); });
    return () => { cancelled = true; };
  }, [projectId]);

  const loadMore = useCallback(async () => {
    if (!users?.length) return;
    const { users: page } = await siteUsersApi.list(projectId, PAGE, users[users.length - 1]!.id);
    setUsers([...users, ...page]);
    setHasMore(page.length === PAGE);
  }, [projectId, users]);

  const setStatus = useCallback(async (userId: number, status: SiteUserStatus) => {
    const updated = await siteUsersApi.setStatus(projectId, userId, status);
    setUsers((current) => current?.map((u) => (u.id === userId ? updated : u)) ?? null);
  }, [projectId]);

  const remove = useCallback(async (userId: number) => {
    await siteUsersApi.remove(projectId, userId);
    setUsers((current) => current?.filter((u) => u.id !== userId) ?? null);
  }, [projectId]);

  return { users, hasMore, loadError, loadMore, setStatus, remove };
}
