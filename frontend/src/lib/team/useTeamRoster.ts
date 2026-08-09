'use client';

import { useEffect, useState } from 'react';
import { getTeamRoster, type TeamRosterMember } from '@/lib/kernel/kernelApi';

/**
 * The ONE client read of the team roster (PRD 21 §4.1).
 *
 * Every consumer — the footer, a presence pile, an assignee picker — asks this
 * rather than calling the endpoint itself, so N consumers mounting in the same
 * commit cost ONE request instead of N. The in-flight promise is shared and the
 * resolved value is held until something invalidates it, which is the client half
 * of the same read-through rule the api keeps with `getOrSetCached`.
 */

let cached: TeamRosterMember[] | null = null;
let inFlight: Promise<TeamRosterMember[]> | null = null;
const subscribers = new Set<(members: TeamRosterMember[]) => void>();

function load(): Promise<TeamRosterMember[]> {
  if (cached) return Promise.resolve(cached);
  inFlight ??= getTeamRoster()
    .then((members) => {
      cached = members;
      for (const notify of subscribers) notify(members);
      return members;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Drop the held roster. Call after any write that changes who is on the team —
 *  the api invalidates its own key, and this is the client side of that. */
export function invalidateTeamRoster(): void {
  cached = null;
  void load();
}

export function useTeamRoster(): { members: TeamRosterMember[]; loading: boolean } {
  const [members, setMembers] = useState<TeamRosterMember[]>(cached ?? []);
  const [loading, setLoading] = useState(cached == null);

  useEffect(() => {
    let live = true;
    const notify = (next: TeamRosterMember[]) => { if (live) setMembers(next); };
    subscribers.add(notify);
    load()
      .then(notify)
      // A roster that cannot be read leaves the footer empty rather than broken:
      // the shell must not fail because one panel's data did not arrive.
      .catch(() => undefined)
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; subscribers.delete(notify); };
  }, []);

  return { members, loading };
}
