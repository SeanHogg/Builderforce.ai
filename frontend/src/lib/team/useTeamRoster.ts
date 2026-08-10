'use client';

import { useEffect, useState } from 'react';
import { getTeamRoster, type TeamRosterMember } from '@/lib/kernel/kernelApi';
import { useAuth } from '@/lib/AuthContext';
import { getOrSetClientCached, invalidateClientCache, readClientCached } from '@/infrastructure/http/readThrough';

/**
 * The ONE client read of the team roster (PRD 21 §4.1).
 *
 * Every consumer — the footer, a presence pile, an assignee picker — asks this
 * rather than calling the endpoint itself, so N consumers mounting in the same
 * commit cost ONE request instead of N. The in-flight promise is shared and the
 * resolved value is held until something invalidates it, which is the client half
 * of the same read-through rule the api keeps with `getOrSetCached`.
 *
 * The endpoint answers for a visitor with no workspace too — the always-on seats,
 * locked — so the footer is present and honest on an anonymous canvas rather than
 * absent. That makes the held value AUDIENCE-SPECIFIC: signing in must not leave
 * the guest's locked seats on screen, so the cache carries who it was read for
 * and drops itself the moment that changes.
 */

type Audience = 'tenant' | 'guest';

const CACHE_PREFIX = 'team-roster:';
const subscribers = new Set<(members: TeamRosterMember[]) => void>();

function load(audience: Audience): Promise<TeamRosterMember[]> {
  return getOrSetClientCached(`${CACHE_PREFIX}${audience}`, () => getTeamRoster())
    .then((members) => {
      for (const notify of subscribers) notify(members);
      return members;
    });
}

/** Drop the held roster. Call after any write that changes who is on the team —
 *  the api invalidates its own key, and this is the client side of that. */
export function invalidateTeamRoster(): void {
  const audience: Audience = readClientCached(`${CACHE_PREFIX}tenant`) ? 'tenant' : 'guest';
  invalidateClientCache(CACHE_PREFIX);
  void load(audience);
}

export function useTeamRoster(): { members: TeamRosterMember[]; loading: boolean } {
  const { hasTenant } = useAuth();
  const audience: Audience = hasTenant ? 'tenant' : 'guest';
  const cached = readClientCached<TeamRosterMember[]>(`${CACHE_PREFIX}${audience}`);
  const fresh = cached != null;
  const [members, setMembers] = useState<TeamRosterMember[]>(cached ?? []);
  const [loading, setLoading] = useState(!fresh);

  useEffect(() => {
    let live = true;
    const notify = (next: TeamRosterMember[]) => { if (live) setMembers(next); };
    subscribers.add(notify);
    setLoading(readClientCached(`${CACHE_PREFIX}${audience}`) == null);
    load(audience)
      .then(notify)
      // A roster that cannot be read leaves the footer empty rather than broken:
      // the shell must not fail because one panel's data did not arrive.
      .catch(() => undefined)
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; subscribers.delete(notify); };
  }, [audience]);

  return { members, loading };
}
