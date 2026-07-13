'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Select } from '@/components/Select';
import {
  migrationsApi,
  integrationsApi,
  type MigrationMode,
  type MigrationRunDetail,
  type IntegrationCredential,
} from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';

/**
 * Migration wizard — connect → discover → map/combine projects → map item types
 * → map users → stage & review → import. Nothing lands in real projects/tasks/
 * members until the final import (commit); everything before that lives in the
 * server-side staging tables, so the run is resumable.
 *
 * Combine = assign several external projects to the SAME existing BF project
 * (action 'map', same target). Self-contained: drives the whole flow over
 * migrationsApi; the parent only supplies the provider id + a close handler.
 */

const STEPS = ['connect', 'projects', 'types', 'users', 'review', 'import'] as const;
type Step = (typeof STEPS)[number];

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-deep)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 10,
  padding: 14,
};
const inputStyle: React.CSSProperties = {
  padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-subtle)',
  borderRadius: 8, background: 'var(--bg-deep)', color: 'var(--text-primary)',
  width: '100%', boxSizing: 'border-box',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)',
  color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
};

export interface MigrationWizardProps {
  open: boolean;
  onClose: () => void;
  provider: string;
  providerLabel: string;
  /** Credentials for this provider (from the gallery config panel). */
  credentials: IntegrationCredential[];
  /** Fired after a successful import so the parent can refresh. */
  onImported?: () => void;
  /** Which edge to dock to. Default 'right'; the Brain opens it 'left'. */
  side?: 'left' | 'right';
  /** Resume an existing run (e.g. one the Brain already started) instead of the connect step. */
  initialRunId?: string | null;
}

/** Map a run's status to the wizard step the operator should resume at. */
function stepForStatus(status: MigrationRunDetail['run']['status']): Step {
  if (status === 'completed') return 'import';
  if (status === 'mapped') return 'review';
  return 'projects';
}

export function MigrationWizard({ open, onClose, provider, providerLabel, credentials, onImported, side = 'right', initialRunId = null }: MigrationWizardProps) {
  const t = useTranslations('integrations');
  const [step, setStep] = useState<Step>('connect');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Connect step
  const [credentialId, setCredentialId] = useState<string>(credentials[0]?.id ?? '');
  const [mode, setMode] = useState<MigrationMode>('both');

  const [detail, setDetail] = useState<MigrationRunDetail | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => { setCredentialId(credentials[0]?.id ?? ''); }, [credentials]);
  useEffect(() => { if (open) fetchProjects().then(setProjects).catch(() => undefined); }, [open]);

  // Resume a run the Brain already started: load its staging snapshot and jump
  // straight to the right step instead of the connect form.
  useEffect(() => {
    if (!open || !initialRunId) return;
    let cancelled = false;
    setBusy(true);
    migrationsApi.get(initialRunId)
      .then((d) => { if (!cancelled) { setDetail(d); setStep(stepForStatus(d.run.status)); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load migration run'); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [open, initialRunId]);

  const reset = useCallback(() => {
    setStep('connect'); setDetail(null); setError(null); setBusy(false); setMode('both');
  }, []);

  const close = () => { reset(); onClose(); };

  const runId = detail?.run.id ?? null;

  // ── Step actions ───────────────────────────────────────────────────────────
  const startDiscovery = async () => {
    if (!credentialId) { setError(t('migration.needCredential')); return; }
    setBusy(true); setError(null);
    try {
      const d = await migrationsApi.start({ provider, credentialId, mode });
      setDetail(d);
      setStep('projects');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('migration.discoveryFailed'));
    } finally { setBusy(false); }
  };

  /** Persist current mappings and advance to the next step. */
  const saveAndGo = async (next: Step) => {
    if (!runId || !detail) return;
    setBusy(true); setError(null);
    try {
      const d = await migrationsApi.setMappings(runId, {
        projects: detail.projects.map((p) => ({ id: p.id, action: p.action, targetProjectId: p.targetProjectId, targetProjectName: p.targetProjectName })),
        types: detail.itemTypes,
        users: detail.users.map((u) => ({ id: u.id, action: u.action, targetUserId: u.targetUserId })),
      });
      setDetail(d);
      setStep(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('migration.saveFailed'));
    } finally { setBusy(false); }
  };

  const stageItems = async () => {
    if (!runId) return;
    setBusy(true); setError(null);
    try {
      // Persist mappings first, then pull the items into staging.
      await migrationsApi.setMappings(runId, {
        projects: detail!.projects.map((p) => ({ id: p.id, action: p.action, targetProjectId: p.targetProjectId, targetProjectName: p.targetProjectName })),
        types: detail!.itemTypes,
        users: detail!.users.map((u) => ({ id: u.id, action: u.action, targetUserId: u.targetUserId })),
      });
      const d = await migrationsApi.stage(runId);
      setDetail(d);
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('migration.stageFailed'));
    } finally { setBusy(false); }
  };

  const runImport = async () => {
    if (!runId || !detail) return;
    setBusy(true); setError(null);
    try {
      // Persist item include toggles, then commit.
      await migrationsApi.setMappings(runId, { items: detail.items.map((i) => ({ id: i.id, include: i.include })) });
      const run = await migrationsApi.commit(runId);
      setDetail((prev) => (prev ? { ...prev, run } : prev));
      setStep('import');
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('migration.importFailed'));
    } finally { setBusy(false); }
  };

  // ── Mutators on the local detail snapshot ───────────────────────────────────
  const patchProject = (id: string, patch: Partial<MigrationRunDetail['projects'][number]>) =>
    setDetail((d) => d ? { ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : d);
  const patchType = (externalType: string, patch: Partial<MigrationRunDetail['itemTypes'][number]>) =>
    setDetail((d) => d ? { ...d, itemTypes: d.itemTypes.map((tp) => (tp.externalType === externalType ? { ...tp, ...patch } : tp)) } : d);
  const patchUser = (id: string, patch: Partial<MigrationRunDetail['users'][number]>) =>
    setDetail((d) => d ? { ...d, users: d.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) } : d);
  const patchItem = (id: string, include: boolean) =>
    setDetail((d) => d ? { ...d, items: d.items.map((i) => (i.id === id ? { ...i, include } : i)) } : d);

  const includedCount = useMemo(() => detail?.items.filter((i) => i.include).length ?? 0, [detail]);

  const tabs = STEPS.map((s) => ({ id: s, label: t(`migration.step.${s}`) }));
  const stepIndex = STEPS.indexOf(step);

  return (
    <SlideOutPanel
      open={open}
      onClose={close}
      title={t('migration.title', { provider: providerLabel })}
      width="min(820px, 98vw)"
      side={side}
      tabs={tabs}
      activeTabId={step}
      onTabChange={(id) => { if (STEPS.indexOf(id as Step) <= stepIndex) setStep(id as Step); }}
    >
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && (
          <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #dc2626)', background: 'var(--surface-2, rgba(220,38,38,0.08))', padding: '8px 12px', borderRadius: 8 }}>
            {error}
          </div>
        )}

        {/* ── Connect ───────────────────────────────────────────── */}
        {step === 'connect' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('migration.connectIntro', { provider: providerLabel })}</p>
            {credentials.length === 0 ? (
              <div style={cardStyle}><span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('migration.noCredentials')}</span></div>
            ) : (
              <label style={{ fontSize: 13, fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {t('migration.credential')}
                <Select value={credentialId} onChange={(e) => setCredentialId(e.target.value)} style={inputStyle}>
                  {credentials.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </label>
            )}
            <label style={{ fontSize: 13, fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {t('migration.mode')}
              <Select value={mode} onChange={(e) => setMode(e.target.value as MigrationMode)} style={inputStyle}>
                <option value="both">{t('migration.modeBoth')}</option>
                <option value="migrate">{t('migration.modeMigrate')}</option>
                <option value="sync">{t('migration.modeSync')}</option>
              </Select>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{t(`migration.modeHint.${mode}`)}</span>
            </label>
            <div>
              <button type="button" style={btnPrimary} disabled={busy || !credentialId} onClick={startDiscovery}>
                {busy ? t('migration.discovering') : t('migration.connectAndDiscover')}
              </button>
            </div>
          </div>
        )}

        {/* ── Projects (map / combine) ──────────────────────────── */}
        {step === 'projects' && detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('migration.projectsIntro')}</p>
            {detail.projects.length === 0 && <div style={cardStyle}>{t('migration.noProjects')}</div>}
            {detail.projects.map((p) => (
              <div key={p.id} style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {p.externalKey || p.externalId}{p.itemCount != null ? ` · ${t('migration.itemsCount', { count: p.itemCount })}` : ''}
                  </div>
                </div>
                <Select value={p.action} onChange={(e) => patchProject(p.id, { action: e.target.value as 'create' | 'map' | 'skip' })} style={{ ...inputStyle, width: 140 }}>
                  <option value="create">{t('migration.actionCreate')}</option>
                  <option value="map">{t('migration.actionMap')}</option>
                  <option value="skip">{t('migration.actionSkip')}</option>
                </Select>
                {p.action === 'create' && (
                  <input style={{ ...inputStyle, width: 200 }} value={p.targetProjectName ?? ''} placeholder={t('migration.newProjectName')} onChange={(e) => patchProject(p.id, { targetProjectName: e.target.value })} />
                )}
                {p.action === 'map' && (
                  <Select value={p.targetProjectId ?? ''} onChange={(e) => patchProject(p.id, { targetProjectId: e.target.value ? Number(e.target.value) : null })} style={{ ...inputStyle, width: 200 }}>
                    <option value="">{t('migration.selectProject')}</option>
                    {projects.map((bp) => <option key={bp.id} value={bp.id}>{bp.name}</option>)}
                  </Select>
                )}
              </div>
            ))}
            <WizardNav busy={busy} onBack={() => setStep('connect')} onNext={() => saveAndGo('types')} t={t} />
          </div>
        )}

        {/* ── Item types ────────────────────────────────────────── */}
        {step === 'types' && detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('migration.typesIntro')}</p>
            {detail.itemTypes.length === 0 && <div style={cardStyle}>{t('migration.noTypes')}</div>}
            {detail.itemTypes.map((tp) => (
              <div key={tp.externalType} style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: '1 1 160px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{tp.externalType}</div>
                <span style={{ color: 'var(--text-muted)' }}>→</span>
                <Select value={tp.targetTaskType} onChange={(e) => patchType(tp.externalType, { targetTaskType: e.target.value })} style={{ ...inputStyle, width: 130 }}>
                  <option value="task">{t('migration.typeTask')}</option>
                  <option value="epic">{t('migration.typeEpic')}</option>
                </Select>
                <input style={{ ...inputStyle, width: 160 }} value={tp.targetStatus} placeholder="backlog" onChange={(e) => patchType(tp.externalType, { targetStatus: e.target.value })} />
              </div>
            ))}
            <WizardNav busy={busy} onBack={() => setStep('projects')} onNext={() => saveAndGo('users')} t={t} />
          </div>
        )}

        {/* ── Users ─────────────────────────────────────────────── */}
        {step === 'users' && detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('migration.usersIntro')}</p>
            {detail.users.length === 0 && <div style={cardStyle}>{t('migration.noUsers')}</div>}
            {detail.users.map((u) => (
              <div key={u.id} style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{u.displayName ?? u.externalId}</div>
                  {u.email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.email}</div>}
                </div>
                <Select value={u.action} onChange={(e) => patchUser(u.id, { action: e.target.value as 'invite' | 'map' | 'skip' })} style={{ ...inputStyle, width: 150 }}>
                  <option value="invite" disabled={!u.email}>{t('migration.userInvite')}</option>
                  <option value="skip">{t('migration.userSkip')}</option>
                </Select>
              </div>
            ))}
            <WizardNav busy={busy} onBack={() => setStep('types')} onNext={stageItems} nextLabel={t('migration.stageAndReview')} t={t} />
          </div>
        )}

        {/* ── Review staged items ───────────────────────────────── */}
        {step === 'review' && detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              {t('migration.reviewIntro', { included: includedCount, total: detail.items.length })}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: 8 }}></th>
                    <th style={{ padding: 8 }}>{t('migration.colTitle')}</th>
                    <th style={{ padding: 8 }}>{t('migration.colType')}</th>
                    <th style={{ padding: 8 }}>{t('migration.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.slice(0, 500).map((i) => (
                    <tr key={i.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: 8 }}>
                        <input type="checkbox" checked={i.include} onChange={(e) => patchItem(i.id, e.target.checked)} aria-label={t('migration.includeItem')} />
                      </td>
                      <td style={{ padding: 8, color: 'var(--text-primary)' }}>{i.title}</td>
                      <td style={{ padding: 8, color: 'var(--text-muted)' }}>{i.targetTaskType}</td>
                      <td style={{ padding: 8, color: 'var(--text-muted)' }}>{i.targetStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.items.length > 500 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 8 }}>{t('migration.truncatedPreview', { total: detail.items.length })}</div>
              )}
            </div>
            <WizardNav busy={busy} onBack={() => setStep('users')} onNext={runImport} nextLabel={t('migration.import', { count: includedCount })} t={t} />
          </div>
        )}

        {/* ── Import done ───────────────────────────────────────── */}
        {step === 'import' && detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {detail.run.status === 'completed' ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--success, #16a34a)' }}>✓ {t('migration.done')}</div>
                <div style={cardStyle}>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <li>{t('migration.summaryProjects', { count: detail.run.summary?.projectsCreated ?? 0 })}</li>
                    <li>{t('migration.summaryTasks', { count: detail.run.summary?.tasksCreated ?? 0 })}</li>
                    <li>{t('migration.summaryUsers', { count: detail.run.summary?.usersInvited ?? 0 })}</li>
                    <li>{t('migration.summaryConnections', { count: detail.run.summary?.connectionsCreated ?? 0 })}</li>
                  </ul>
                </div>
                <div><button type="button" style={btnPrimary} onClick={close}>{t('migration.finish')}</button></div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('migration.importing')}</div>
            )}
          </div>
        )}
      </div>
    </SlideOutPanel>
  );
}

function WizardNav({ busy, onBack, onNext, nextLabel, t }: {
  busy: boolean; onBack: () => void; onNext: () => void; nextLabel?: string;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
      <button type="button" style={btnSubtle} disabled={busy} onClick={onBack}>{t('migration.back')}</button>
      <button type="button" style={btnPrimary} disabled={busy} onClick={onNext}>
        {busy ? t('migration.working') : (nextLabel ?? t('migration.next'))}
      </button>
    </div>
  );
}
