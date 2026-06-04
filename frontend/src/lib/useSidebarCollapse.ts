'use client';

import { useState, useCallback, useEffect } from 'react';

const SIDEBAR_COLLAPSED_KEY = 'builderforce-sidebar-collapsed';

/**
 * Shared sidebar collapse state for the app + public shells. The user's manual
 * preference persists to localStorage; pass `routeCollapsed` for routes that
 * force icon-only mode (IDE/project pages). Manual choice is never overwritten
 * except when a route forces collapse.
 */
export function useSidebarCollapse(routeCollapsed = false): { collapsed: boolean; toggle: () => void } {
  const [userCollapsed, setUserCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  });

  const collapsed = routeCollapsed || userCollapsed;

  // Persist when a route forces collapse (external system → useEffect; no setState).
  useEffect(() => {
    if (routeCollapsed && typeof window !== 'undefined') {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    }
  }, [routeCollapsed]);

  const toggle = useCallback(() => {
    setUserCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
