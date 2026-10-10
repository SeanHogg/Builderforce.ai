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
import { useViewerSession } from '@/lib/viewerSession';
import { scopeChangeEffect, type ScopeChangeEffect } from '@/lib/canvasScopePolicy';
import { readLocationProject, resolveProjectId, toProjectId } from '@/lib/projectScopeResolution';

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
 *
 * The ORDER between those sources is not decided here — it is
 * {@link resolveProjectId}, the one answer to "which project?" on every surface.
 *
 * A host that owns the selection itself (the VS Code editor's sidebar project)
 * mounts this with a {@link ProjectScopeHost}: the host's choice is then the
 * answer, a pick is handed back to the host instead of written to localStorage or
 * the URL, and the stale-selection cleanup stands down because the host — not this
 * page — decides what is selected.
 */
export interface ProjectScopeValue {
  /** All projects in the active tenant (loaded once, refreshable). */
  projects: Project[];
  loading: boolean;
  /** The drilled-into project, or null for the all-projects (portfolio) view. */
  currentProjectId: number | null;
  /** The resolved current project object, or null in the all-projects view. */
  currentProject: Project | null;
  /**
   * Select a project (or null for all projects). Persists + reflects to URL.
   *
   * `effect` is the resolved `scopeChangeEffect('project', …)` when the caller has
   * one — the switcher resolves it ONCE and applies the board/room halves itself,
   * so the workbench half applied here reads the same object. Omitted by callers
   * with no surface to consult (a create path, the stale-selection cleanup), which
   * resolve the project axis with no live room.
   */
  setProject: (id: number | null, effect?: ScopeChangeEffect) => void;
  /** Re-fetch the project list (e.g. after creating/deleting a project). */
  reload: () => void;
  /**
   * Adopt a just-created project: splice it into the list AND select it. Use
   * this from every create path instead of `reload()` + `setProject()` — the
   * optimistic splice is what stops the stale-selection cleanup from bouncing
   * the new id back to null while the refetch is still in flight.
   */
  adoptProject: (project: Project) => void;
}

/**
 * The port a host supplies when IT owns the project selection (the editor sidebar).
 * `projectId` is the host's current choice (null = all projects); `select` asks the
 * host to change it, and the new choice comes back through `projectId`.
 */
export interface ProjectScopeHost {
  projectId: number | null;
  select: (id: number | null) => void;
}

const ProjectScopeContext = createContext<ProjectScopeValue | null>(null);

function storageKey(tenantId: string | null | undefined): string {
  return `bf-project:${tenantId ?? 'none'}`;
}

/** The per-tenant persisted pick (client only). */
function readStoredProject(tenantId: string | null): number | null {
  try {
    return toProjectId(localStorage.getItem(storageKey(tenantId)));
  } catch {
    return null;
  }
}

export function ProjectScopeProvider({ children, host }: { children: React.ReactNode; host?: ProjectScopeHost }) {
  const { hasTenant, tenantId } = useViewerSession();
  const router = useRouter();
  const pathname = usePathname();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  // The pick made in THIS page; a host-owned selection outranks it in `currentProjectId`.
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const currentProjectId = resolveProjectId({ host: host?.projectId, selected: selectedProjectId });
  const hostSelect = host?.select;

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

  // Seed the page's pick when the tenant changes, from the URL deep-link and the
  // per-tenant persisted choice — ranked by `resolveProjectId`, not here. Skipped
  // when a host owns the selection: there is nothing of the page's own to seed.
  useEffect(() => {
    if (hostSelect) return;
    // Sync from external sources (URL deep-link / persisted choice) on tenant
    // change — an intentional state sync, not a derived-state cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedProjectId(resolveProjectId({ location: readLocationProject(), selected: readStoredProject(tenantId) }));
  }, [tenantId, hostSelect]);

  // Adopt an explicit `?project=` deep-link when navigating between pages
  // (e.g. a "View workflows" / "Open Builder" button on a project). We only ever
  // ADOPT a param that is present — a plain navigation to a page without it
  // keeps the current selection rather than resetting to all-projects. Keyed on
  // pathname so it fires on cross-page navigation; same-page changes are driven
  // by setProject (router.replace below), which does not change the pathname.
  useEffect(() => {
    if (hostSelect) return;
    const fromUrl = readLocationProject();
    if (fromUrl == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedProjectId(fromUrl);
    try {
      localStorage.setItem(storageKey(tenantId), String(fromUrl));
    } catch {
      /* storage unavailable — context state still holds the choice */
    }
  }, [pathname, tenantId, hostSelect]);

  const setProject = useCallback(
    (id: number | null, effect: ScopeChangeEffect = scopeChangeEffect('project', false)) => {
      setSelectedProjectId(id);
      // The host owns the selection: hand the pick back and let its answer return
      // through `host.projectId`. Neither localStorage nor the URL is this page's to
      // write — in the editor a router navigation would reveal another panel.
      if (hostSelect) {
        hostSelect(id);
        return;
      }
      try {
        if (id == null) localStorage.removeItem(storageKey(tenantId));
        else localStorage.setItem(storageKey(tenantId), String(id));
      } catch {
        /* storage unavailable — context state still holds the choice */
      }
      // The workbench half of the scope policy. `refetch` keeps the selected tab —
      // every other param survives and only `?project=` changes, so the docked page
      // re-reads in the new scope where it stood and the URL stays shareable. `reopen`
      // drops them: the page is reopened on the same destination with nothing carried
      // across. `keep` leaves the URL alone because the destination does not read
      // this axis.
      if (effect.workbench === 'keep' || typeof window === 'undefined') return;
      const params = effect.workbench === 'refetch' ? new URLSearchParams(window.location.search) : new URLSearchParams();
      if (id == null) params.delete('project');
      else params.set('project', String(id));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [tenantId, router, pathname, hostSelect],
  );

  const adoptProject = useCallback(
    (project: Project) => {
      setProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [...prev, project]));
      setProject(project.id);
      reload();
    },
    [setProject, reload],
  );

  // Drop a stale selection (e.g. project deleted or belongs to another tenant)
  // once the list has loaded, so we never scope to a non-existent project.
  // A host-owned selection is the host's to correct, never this page's.
  useEffect(() => {
    if (hostSelect) return;
    if (currentProjectId != null && projects.length > 0 && !projects.some((p) => p.id === currentProjectId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProject(null);
    }
  }, [projects, currentProjectId, setProject, hostSelect]);

  const currentProject = useMemo(
    () => projects.find((p) => p.id === currentProjectId) ?? null,
    [projects, currentProjectId],
  );

  const value = useMemo<ProjectScopeValue>(
    () => ({ projects, loading, currentProjectId, currentProject, setProject, reload, adoptProject }),
    [projects, loading, currentProjectId, currentProject, setProject, reload, adoptProject],
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

/**
 * The tenant's project list for a picker or a filter.
 *
 * From the provider when one is above — the shell loads the list ONCE, and a
 * lens that fetched its own copy was a second request for the same twenty rows
 * on every mount — and loaded here otherwise, so the same component works on the
 * surfaces (embed, guest) that have no shell. Either way the consumer holds no
 * state and no effect of its own.
 */
export function useProjects(): Project[] {
  const scope = useOptionalProjectScope();
  const [own, setOwn] = useState<Project[]>([]);
  useEffect(() => {
    if (scope) return;
    let live = true;
    fetchProjects()
      .then((list) => { if (live) setOwn(list); })
      .catch(() => { if (live) setOwn([]); });
    return () => { live = false; };
  }, [scope]);
  return scope ? scope.projects : own;
}
