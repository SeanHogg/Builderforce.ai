'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { kanbanApi, type AssigneeProfileMap, type AssigneeProfileDto } from '@/lib/builderforceApi';

/**
 * One shared fetch of the tenant's assignee → personality map, exposed as a lookup
 * so every board card / task-drawer / standup row reads the SAME data without an
 * N+1 (the board mounts the provider once; each hovercard just looks itself up by
 * the encoded assignee select-value). The endpoint is open to any member and only
 * returns assignees that actually carry a personality, so the map is small and the
 * hovercard self-hides for everyone else.
 *
 * Rendered outside a provider (e.g. a surface that hasn't opted in yet), the lookup
 * returns `undefined` for everything, so a hovercard can be dropped in anywhere and
 * simply renders its trigger untouched.
 */

const Ctx = createContext<AssigneeProfileMap | null>(null);

export function AssigneeProfilesProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<AssigneeProfileMap>({});
  useEffect(() => {
    let cancelled = false;
    // Best-effort: a failure just means hovercards render their trigger with no
    // personality popover, never a thrown error in the board.
    kanbanApi.assigneeProfiles().then((m) => { if (!cancelled) setProfiles(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return <Ctx.Provider value={profiles}>{children}</Ctx.Provider>;
}

/**
 * One assignee's personality, looked up by the encoded select-value the picker uses
 * (`u:<userId>` humans / `c:<agentRef>` cloud agents). Undefined when the assignee
 * has no personality on file (or when rendered outside a provider).
 */
export function useAssigneeProfile(selectValue: string | null | undefined): AssigneeProfileDto | undefined {
  const map = useContext(Ctx);
  if (!map || !selectValue) return undefined;
  return map[selectValue];
}
