/**
 * Consolidate projects — bulk-assign every checked unassigned project to one
 * company in a single action, instead of the one-at-a-time picker in
 * `CompanyWork` (CompaniesView.tsx). Loops the existing per-project attach
 * call (`investorApi.projects.attach`); no batch endpoint exists or is needed
 * — this is a UI convenience over the same REST contract `CompanyWork` uses.
 *
 * Self-contained: owns its own fetch of the available list and its own
 * selection state, so it can be dropped into any company surface unchanged.
 *
 * No `'use client'`: the boundary is `InvestorClient.tsx`, same reasoning as
 * `CompaniesView.tsx`.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { investorApi, type CompanyProject } from '@/lib/investorApi';
import { emptyStyle, errorStyle, listRowStyle, listStyle, mutedStyle, primaryButtonStyle } from './investorStyles';

export function ConsolidateProjectsPanel({
  companyId,
  companyName,
  open,
  onClose,
  onDone,
}: {
  companyId: number;
  companyName: string;
  open: boolean;
  onClose: () => void;
  /** Called after at least one project was successfully assigned, so the
   *  caller can refresh the company detail and the available-projects list. */
  onDone: () => void;
}) {
  const t = useTranslations('investor');
  const [available, setAvailable] = useState<CompanyProject[]>([]);
  // Starts true rather than being set in the effect: the caller only mounts this
  // panel while it's open (a fresh mount per open, so no manual reset-on-reopen
  // is needed), and the fetch below always begins on mount.
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    investorApi.projects
      .available(companyId)
      .then((rows) => { if (!cancelled) setAvailable(rows); })
      .catch(() => { if (!cancelled) setAvailable([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  const toggle = useCallback((projectId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  }, []);

  const submit = useCallback(async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    const ids = Array.from(selected);
    const results = await Promise.allSettled(ids.map((projectId) => investorApi.projects.attach(companyId, projectId)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    setBusy(false);
    if (failed === ids.length) {
      setError(t('error.attachProject'));
      return;
    }
    onDone();
    if (failed > 0) {
      setError(t('error.attachProject'));
      return;
    }
    onClose();
  }, [companyId, onClose, onDone, selected, t]);

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={t('companies.consolidate')}
      crumb={companyName}
      accentVar="--seat-ceo"
      width="sheet"
      widthStorageKey="investor-consolidate-projects"
    >
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={mutedStyle}>{t('companies.consolidateBlurb', { name: companyName })}</p>

        {error && <p style={errorStyle} role="alert">{error}</p>}

        {loading ? (
          <p style={mutedStyle}>{t('common.loading')}</p>
        ) : available.length === 0 ? (
          <p style={emptyStyle}>{t('companies.consolidateEmpty')}</p>
        ) : (
          <ul style={listStyle}>
            {available.map((project) => (
              <li key={project.id}>
                <label style={{ ...listRowStyle, cursor: 'pointer' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={selected.has(project.id)}
                      onChange={() => toggle(project.id)}
                    />
                    <span style={{ minWidth: 0 }}>
                      <b style={{ display: 'block' }}>{project.name}</b>
                      <small style={mutedStyle}>{project.key} · {project.status}</small>
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <span style={mutedStyle}>
            {selected.size > 0 ? t('companies.consolidateSelected', { count: selected.size }) : null}
          </span>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={submit}
            disabled={busy || selected.size === 0}
          >
            {busy ? t('common.saving') : t('companies.consolidateSubmit', { count: selected.size || 1 })}
          </button>
        </div>
      </div>
    </SlideOutPanel>
  );
}
