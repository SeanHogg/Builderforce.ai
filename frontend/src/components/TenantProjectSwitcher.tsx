'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { useDismissable } from '@/lib/useDismissable';
import { MenuDivider, MenuScroll, MenuSectionLabel, MenuSurface, menuItemStyle } from '@/components/workspace/MenuSurface';

/** Down chevron matching the legacy workspace chip. */
function Chevron() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * The single tenant → project selector in the TopBar. Tenant is the workspace;
 * project is the optional drill-down inside it ("All projects" = the tenant-wide
 * portfolio view). This is the ONE project picker for the whole app — every
 * project-scoped surface reads {@link useProjectScope}, so we never re-inline a
 * per-page project dropdown.
 *
 * Switching PROJECT is a filter: it never crosses an identity boundary, so an
 * open canvas and a live session are untouched by it. Switching WORKSPACE is an
 * identity change, which is why that action leaves via `/tenants` rather than
 * being a row in this menu.
 *
 * Outside the authenticated app shell (public/marketing shell, embed) there is
 * no ProjectScopeProvider, so it degrades to the plain workspace chip.
 */
export function TenantProjectSwitcher() {
  const t = useTranslations('projectScope');
  const { tenant, isAuthenticated } = useAuth();
  const scope = useOptionalProjectScope();
  const { open, toggle, close, ref } = useDismissable<HTMLDivElement>();

  if (!isAuthenticated || !tenant) return null;

  const tenantName = tenant.name || tenant.id;

  // No project scope in context (public/marketing shell) → plain workspace chip.
  if (!scope) {
    return (
      <Link href="/tenants" className="tenant-chip" style={{ textDecoration: 'none' }} title={`${tenantName} (${t('workspace')})`}>
        <span className="tenant-chip__project">{tenantName}</span>
        <span className="tenant-chip__workspace" style={{ opacity: 0.6, fontWeight: 400, marginLeft: 4 }}>({t('workspace')})</span>
        <Chevron />
      </Link>
    );
  }

  const { projects, currentProjectId, currentProject, setProject } = scope;
  const projectLabel = currentProject ? currentProject.name : t('allProjects');

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="tenant-chip"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${tenantName} · ${projectLabel}`}
        style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
      >
        <span className="tenant-chip__workspace">{tenantName}</span>
        <span className="tenant-chip__sep" aria-hidden="true" style={{ opacity: 0.5, margin: '0 4px' }}>▸</span>
        <span className="tenant-chip__project" style={{ fontWeight: 600 }}>{projectLabel}</span>
        <Chevron />
      </button>

      {open && (
        <MenuSurface label={t('selectAria')}>
          <MenuSectionLabel>{t('projectLabel')}</MenuSectionLabel>
          <MenuScroll>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={currentProjectId == null}
              onClick={() => { setProject(null); close(); }}
              style={menuItemStyle(currentProjectId == null)}
            >
              {t('allProjects')}
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={currentProjectId === p.id}
                onClick={() => { setProject(p.id); close(); }}
                style={menuItemStyle(currentProjectId === p.id)}
              >
                {p.name}
              </button>
            ))}
            {projects.length === 0 && (
              <div style={{ padding: '7px 10px', fontSize: 13, color: 'var(--text-muted)' }}>{t('noProjects')}</div>
            )}
          </MenuScroll>
          <MenuDivider />
          <Link href="/tenants" role="menuitem" onClick={close} style={menuItemStyle(false)}>
            {t('switchWorkspace')}
          </Link>
        </MenuSurface>
      )}
    </div>
  );
}
