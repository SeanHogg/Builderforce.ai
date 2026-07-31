'use client';

/**
 * useRoles — the ONE roles-CRUD hook shared by every surface that lists, creates,
 * or deletes workspace job-roles (the Workforce → Roles tab {@link RolesView} and
 * the Projects → Templates roles sub-tab). Both used to hand-roll the same
 * list/create/delete calls and could drift; this owns them so they never do.
 *
 * Callers own their own error surfacing — pass `onError` to receive the message.
 * `roles`/`setRoles` are exposed so a host that co-loads roles with other data
 * (templates, assignments) can seed the list and still get optimistic deletes.
 */
import { useCallback, useState } from 'react';
import { kanbanApi } from '@/lib/builderforceApi';
import type { Discipline, JobRole } from '@/lib/kanban';

/** The canonical discipline taxonomy for the role picker — single source. */
export const ROLE_DISCIPLINES: Discipline[] = [
  'engineering', 'product', 'design', 'qa', 'devops', 'data', 'security', 'other',
];

export interface UseRoles {
  roles: JobRole[];
  setRoles: React.Dispatch<React.SetStateAction<JobRole[]>>;
  /** True while a create is in flight (for disabling the submit button). */
  creating: boolean;
  /** Re-fetch the full role list from the server. */
  reloadRoles: () => Promise<void>;
  /** Create a role; returns true on success (so the caller can reset its form). */
  createRole: (name: string, discipline: Discipline) => Promise<boolean>;
  /** Delete a custom role (built-ins are a no-op); optimistically drops it. */
  deleteRole: (role: JobRole) => Promise<void>;
}

export function useRoles(opts?: { onError?: (message: string) => void }): UseRoles {
  const onError = opts?.onError;
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [creating, setCreating] = useState(false);

  const report = useCallback((e: unknown) => onError?.((e as Error).message), [onError]);

  const reloadRoles = useCallback(async () => {
    try { setRoles(await kanbanApi.listRoles()); }
    catch (e) { report(e); }
  }, [report]);

  const createRole = useCallback(async (name: string, discipline: Discipline) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    setCreating(true);
    try {
      await kanbanApi.createRole({ name: trimmed, discipline });
      await reloadRoles();
      return true;
    } catch (e) { report(e); return false; }
    finally { setCreating(false); }
  }, [reloadRoles, report]);

  const deleteRole = useCallback(async (role: JobRole) => {
    if (role.builtin) return;
    try {
      await kanbanApi.deleteRole(role.key);
      setRoles((prev) => prev.filter((r) => r.key !== role.key));
    } catch (e) { report(e); }
  }, [report]);

  return { roles, setRoles, creating, reloadRoles, createRole, deleteRole };
}
