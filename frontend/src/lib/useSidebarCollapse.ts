'use client';

import { useState, useCallback, useEffect } from 'react';
import { readLocal, writeLocal } from './storage';

const SIDEBAR_COLLAPSED_KEY = 'builderforce-sidebar-collapsed';

/**
 * Shared sidebar collapse state for the app + public shells. The user's manual
 * preference persists to localStorage; pass `routeCollapsed` for routes that
 * force icon-only mode (IDE/project pages). Manual choice is never overwritten
 * except when a route forces collapse.
 */
export function useSidebarCollapse(routeCollapsed = false): { collapsed: boolean; toggle: () => void } {
  // `readLocal` is null on the server and in Safari private mode alike — this
  // used to throw on the second, which took the whole shell down with it.
  const [userCollapsed, setUserCollapsed] = useState<boolean>(() => readLocal(SIDEBAR_COLLAPSED_KEY) === '1');

  const collapsed = routeCollapsed || userCollapsed;

  // Persist when a route forces collapse (external system → useEffect; no setState).
  useEffect(() => {
    if (routeCollapsed) writeLocal(SIDEBAR_COLLAPSED_KEY, '1');
  }, [routeCollapsed]);

  const toggle = useCallback(() => {
    setUserCollapsed((prev) => {
      const next = !prev;
      writeLocal(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
