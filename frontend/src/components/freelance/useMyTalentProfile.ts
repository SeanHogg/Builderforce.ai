'use client';

import { useCallback, useEffect, useState } from 'react';
import { getMyFreelancerProfileCached, invalidateMyFreelancerProfile, updateMyFreelancerProfile, type FreelancerProfile } from '@/lib/freelance/talentProfile';

/**
 * Read-through cache for the signed-in user's own for-hire profile.
 *
 * The onboarding wizard renders one step at a time, and three of its steps edit
 * the same profile — without this the profile would be re-fetched on every step
 * change. The in-flight promise is shared and only invalidated on write, so a
 * wizard pass costs ONE GET.
 */
export function loadMyTalentProfile(force = false): Promise<FreelancerProfile> {
  return getMyFreelancerProfileCached(force);
}

export function invalidateMyTalentProfile(): void {
  invalidateMyFreelancerProfile();
}

export interface MyTalentProfileState {
  profile: FreelancerProfile | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  saved: boolean;
  /** Local-only edit (not persisted until `save()`). */
  patch: (p: Partial<FreelancerProfile>) => void;
  /** Persist the given fields, then invalidate the shared cache. */
  save: (p: Partial<FreelancerProfile>) => Promise<boolean>;
}

export function useMyTalentProfile(): MyTalentProfileState {
  const [profile, setProfile] = useState<FreelancerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadMyTalentProfile()
      .then((p) => { if (alive) setProfile(p); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const patch = useCallback((p: Partial<FreelancerProfile>) => {
    setSaved(false);
    setProfile((prev) => (prev ? { ...prev, ...p } : prev));
  }, []);

  const save = useCallback(async (p: Partial<FreelancerProfile>) => {
    setSaving(true); setError(null); setSaved(false);
    try {
      await updateMyFreelancerProfile(p);
      invalidateMyTalentProfile();
      setProfile((prev) => (prev ? { ...prev, ...p } : prev));
      setSaved(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { profile, loading, saving, saved, error, patch, save };
}
