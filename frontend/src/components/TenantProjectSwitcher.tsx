'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';

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
 * Outside the authenticated app shell (public/marketing shell, embed) there is
 * no ProjectScopeProvider, so it degrades to the plain workspace chip.
 */
export function TenantProjectSwitcher() {
  const t = useTranslations('projectScope');
  const { tenant, isAuthenticated } = useAuth();
  const scope = useOptionalProjectScope();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!isAuthenticated || !tenant) return null;

  const tenantName = tenant.name || tenant.id;

  // No project scope in context (public/marketing shell) → plain workspace chip.
  if (!scope) {
    return (
      <Link href="/tenants" className="tenant-chip" style={{ textDecoration: 'none' }} title={`${tenantName} (${t('workspace')})`}>
        {tenantName}
        <span style={{ opacity: 0.6, fontWeight: 400, marginLeft: 4 }}>({t('workspace')})</span>
        <Chevron />
      </Link>
    );
  }

  const { projects, currentProjectId, currentProject, setProject } = scope;
  const projectLabel = currentProject ? currentProject.name : t('allProjects');

  const itemStyle = (active: boolean): React.CSSProperties => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '7px 10px',
    fontSize: 13,
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-primary)',
    background: active ? 'var(--surface-coral-soft)' : 'transparent',
    fontWeight: active ? 600 : 400,
    textDecoration: 'none',
  });

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="tenant-chip"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${tenantName} · ${projectLabel}`}
        style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
      >
        <span>{tenantName}</span>
        <span aria-hidden="true" style={{ opacity: 0.5, margin: '0 4px' }}>▸</span>
        <span style={{ fontWeight: 600 }}>{projectLabel}</span>
        <Chevron />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('selectAria')}
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            minWidth: 220,
            maxWidth: 320,
            background: 'var(--panel-drawer-bg, var(--bg-elevated))',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            zIndex: 100000,
            padding: 6,
          }}
        >
          <div style={{ padding: '4px 10px 2px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>
            {t('projectLabel')}
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={currentProjectId == null}
              onClick={() => { setProject(null); setOpen(false); }}
              style={itemStyle(currentProjectId == null)}
            >
              {t('allProjects')}
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={currentProjectId === p.id}
                onClick={() => { setProject(p.id); setOpen(false); }}
                style={itemStyle(currentProjectId === p.id)}
              >
                {p.name}
              </button>
            ))}
            {projects.length === 0 && (
              <div style={{ padding: '7px 10px', fontSize: 13, color: 'var(--text-muted)' }}>{t('noProjects')}</div>
            )}
          </div>
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '6px 4px' }} />
          <Link
            href="/tenants"
            role="menuitem"
            onClick={() => setOpen(false)}
            style={itemStyle(false)}
          >
            {t('switchWorkspace')}
          </Link>
        </div>
      )}
    </div>
  );
}
