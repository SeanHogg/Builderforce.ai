'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  NAVIGATION_FEATURE_IDS,
  type NavigationFeatureId,
} from './navigationFeatures';
import { getNavigationFeatures, saveNavigationFeatures } from './navigationFeaturesApi';

interface NavigationFeaturesValue {
  enabled: ReadonlySet<NavigationFeatureId>;
  enabledIds: NavigationFeatureId[];
  loading: boolean;
  save: (enabled: readonly NavigationFeatureId[]) => Promise<void>;
}

const NavigationFeaturesContext = createContext<NavigationFeaturesValue | null>(null);

export function NavigationFeaturesProvider({ children }: { children: React.ReactNode }) {
  const { tenant } = useAuth();
  const [enabledIds, setEnabledIds] = useState<NavigationFeatureId[]>([...NAVIGATION_FEATURE_IDS]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!tenant?.id) {
      setEnabledIds([...NAVIGATION_FEATURE_IDS]);
      return () => { active = false; };
    }
    setLoading(true);
    void getNavigationFeatures(tenant.id)
      .then((result) => { if (active) setEnabledIds(result.enabled); })
      // Preserve the current all-on navigation if preferences cannot load.
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenant?.id]);

  const save = useCallback(async (next: readonly NavigationFeatureId[]) => {
    if (!tenant?.id) return;
    const result = await saveNavigationFeatures(tenant.id, next);
    setEnabledIds(result.enabled);
  }, [tenant?.id]);

  const value = useMemo<NavigationFeaturesValue>(() => ({
    enabled: new Set(enabledIds),
    enabledIds,
    loading,
    save,
  }), [enabledIds, loading, save]);

  return <NavigationFeaturesContext.Provider value={value}>{children}</NavigationFeaturesContext.Provider>;
}

export function useNavigationFeatures(): NavigationFeaturesValue {
  const value = useContext(NavigationFeaturesContext);
  if (!value) throw new Error('useNavigationFeatures must be used inside NavigationFeaturesProvider');
  return value;
}
