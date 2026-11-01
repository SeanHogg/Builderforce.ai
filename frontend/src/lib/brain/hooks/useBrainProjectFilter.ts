import { useCallback, useState } from 'react';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';

/**
 * The Brain's chat-list project filter.
 *
 * Project scope follows the global TopBar tenant→project selector — one picker
 * for the whole app (see ProjectScopeContext). The Brain's filter dropdown
 * reflects and drives it, so a chat created while scoped to a project is
 * assigned to that project (new chats default to the active filter). "No
 * project" is a local-only refinement (show unassigned chats) the global scope
 * can't express — null there means "all projects", not "unassigned". When there
 * is no scope provider (embed surfaces, outside the app shell) we fall back to
 * a purely local filter so the dropdown still works.
 */
export function useBrainProjectFilter() {
  const scope = useOptionalProjectScope();
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [localFilter, setLocalFilter] = useState<string | null>(null);
  const filterProjectId: string | null = scope
    ? (scope.currentProjectId != null
        ? String(scope.currentProjectId)
        : (unassignedOnly ? 'none' : null))
    : localFilter;
  const setFilterProjectId = useCallback((v: string) => {
    if (!scope) { setLocalFilter(v === '' ? null : v); return; }
    if (v === 'none') { setUnassignedOnly(true); scope.setProject(null); }
    else if (v === '') { setUnassignedOnly(false); scope.setProject(null); }
    else { setUnassignedOnly(false); scope.setProject(Number(v)); }
  }, [scope]);
  return { filterProjectId, setFilterProjectId };
}
