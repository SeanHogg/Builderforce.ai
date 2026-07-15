'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { useAuth } from '@/lib/AuthContext';

/**
 * Global project scope — the second scoping axis, sibling to {@link useAuth}'s
 * tenant. Tenant is the workspace; project is an OPTIONAL drill-down inside it.
 *
 * `currentProjectId == null` is a first-class state meaning "all projects" (the
 * tenant-wide / portfolio rollup) — not "nothing selected". Surfaces that are
 * genuinely tenant-wide surfaces may ignore this; project-scoped surfaces
 * (Planning, Tasks, Ceremonies, Insights) read it so there is ONE project picker
 * (the TopBar TenantProjectSwitcher) instead of a bespoke dropdown per surface.
 *
 * Source of truth: this context, persisted per-tenant in localStorage so the
 * choice survives navigation between tabs/sections (the way the tenant does).
 * A `?project=<id>` deep-link in the initial URL wins on load (so links into a
 * specific project's board still work), and `setProject` reflects the choice
 * back into `?project=` on the current path so URLs stay shareable.
 */
export interface ProjectScopeValue {
  /** All projects in the active tenant (loaded once, refreshable). */
  projects: Project[];
  loading: boolean;
  /** The drilled-into project, or null for the all-projects (portfolio) view. */
  currentProjectId: number | null;
  /** The resolved current project object, or null in the all-projects view. */
  currentProject: Project | null;
  /** Select a project (or null for all projects). Persists + reflects to URL. */
  setProject: (id: number | null) => void;
  /** Re-fetch the project list (e.g. after creating/deleting a project). */
  reload: () => void;
}

const ProjectScopeContext = createContext<ProjectScopeValue | null>(null);

function storageKey(tenantId: string | null | undefined): string {
  return `bf-project:${tenantId ?? 'none'}`;
}

/** Read `?project=<id>` from the live URL (client only). Positive int or null. */
function readUrlProject(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('project');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function ProjectScopeProvider({ children }: { children: React.ReactNode }) {
  const { tenant, hasTenant } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const tenantId = tenant?.id ?? null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null);

  const reload = useCallback(() => {
    if (!hasTenant) {
      setProjects([]);
      return;
    }
    setLoading(true);
    fetchProjects()
      .then((p) => setProjects(p))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [hasTenant]);

  // Load the project list whenever the active tenant changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload, tenantId]);

  // Seed the current project when the tenant changes: a `?project=` deep-link in
  // the URL wins, otherwise the per-tenant persisted choice, otherwise null.
  useEffect(() => {
    // Sync from external sources (URL deep-link / persisted choice) on tenant
    // change — an intentional state sync, not a derived-state cascade.
    /* eslint-disable react-hooks/set-state-in-effect */
    const fromUrl = readUrlProject();
    if (fromUrl != null) {
      setCurrentProjectId(fromUrl);
      return;
    }
    try {
      const stored = Number(localStorage.getItem(storageKey(tenantId)));
      setCurrentProjectId(Number.isFinite(stored) && stored > 0 ? stored : null);
    } catch {
      setCurrentProjectId(null);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [tenantId]);

  // Adopt an explicit `?project=` deep-link when navigating between pages
  // (e.g. a "View workflows" / "Open IDE" button on a project). We only ever
  // ADOPT a param that is present — a plain navigation to a page without it
  // keeps the current selection rather than resetting to all-projects. Keyed on
  // pathname so it fires on cross-page navigation; same-page changes are driven
  // by setProject (router.replace below), which does not change the pathname.
  useEffect(() => {
    const fromUrl = readUrlProject();
    if (fromUrl == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentProjectId(fromUrl);
    try {
      localStorage.setItem(storageKey(tenantId), String(fromUrl));
    } catch {
      /* storage unavailable — context state still holds the choice */
    }
  }, [pathname, tenantId]);

  const setProject = useCallback(
    (id: number | null) => {
      setCurrentProjectId(id);
      try {
        if (id == null) localStorage.removeItem(storageKey(tenantId));
        else localStorage.setItem(storageKey(tenantId), String(id));
      } catch {
        /* storage unavailable — context state still holds the choice */
      }
      // Reflect into `?project=` on the current path (keep other params), so the
      // URL stays shareable without forcing a navigation.
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (id == null) params.delete('project');
        else params.set('project', String(id));
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }
    },
    [tenantId, router, pathname],
  );

  // Drop a stale selection (e.g. project deleted or belongs to another tenant)
  // once the list has loaded, so we never scope to a non-existent project.
  useEffect(() => {
    if (currentProjectId != null && projects.length > 0 && !projects.some((p) => p.id === currentProjectId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProject(null);
    }
  }, [projects, currentProjectId, setProject]);

  const currentProject = useMemo(
    () => projects.find((p) => p.id === currentProjectId) ?? null,
    [projects, currentProjectId],
  );

  const value = useMemo<ProjectScopeValue>(
    () => ({ projects, loading, currentProjectId, currentProject, setProject, reload }),
    [projects, loading, currentProjectId, currentProject, setProject, reload],
  );

  return <ProjectScopeContext.Provider value={value}>{children}</ProjectScopeContext.Provider>;
}

export function useProjectScope(): ProjectScopeValue {
  const ctx = useContext(ProjectScopeContext);
  if (!ctx) throw new Error('useProjectScope must be used within a ProjectScopeProvider');
  return ctx;
}

/**
 * Non-throwing variant: returns null when there is no ProjectScopeProvider above
 * (e.g. the public/marketing shell or the embed surfaces, which scope project
 * explicitly). Shared chrome like the TopBar switcher uses this to degrade
 * gracefully instead of crashing outside the authenticated app shell.
 */
export function useOptionalProjectScope(): ProjectScopeValue | null {
  return useContext(ProjectScopeContext);
}
