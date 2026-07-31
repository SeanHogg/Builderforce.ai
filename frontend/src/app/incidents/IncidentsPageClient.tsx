'use client';

/**
 * IncidentsPageClient — the Incident Management surface. Four sub-views selected
 * via the shared <PillTabs> (?tab=): live Incident war rooms, On-call rotations,
 * Escalation policies, and a Business-contact directory. Detail / create flows use
 * the canonical <SlideOutPanel> (never a modal) and destructive removals go through
 * useConfirm(). Writes are gated to manager+ (mirrors the API requireRole(MANAGER)).
 * Fully localized (incidents namespace) + theme-driven (never one-theme hex).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import PageContainer from '@/components/PageContainer';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Select } from '@/components/Select';
import { useConfirm } from '@/components/ConfirmProvider';
import { useRole, hasMinRole } from '@/lib/rbac';
import { MonitorsSection, MonitoringReporting } from '@/components/reliability/MonitoringSections';
import { FishboneChart, type FishboneCategory } from '@/components/charts/FishboneChart';
import type { ImplicatedTicket } from '@/lib/kanban';
import {
  incidentsApi,
  workflowDefinitions,
  type Incident,
  type IncidentEvent,
  type IncidentSeverity,
  type IncidentStatus,
  type PostmortemDocType,
  type OnCallRotation,
  type RotationKind,
  type EscalationPolicy,
  type EscalationTargetKind,
  type BusinessContact,
  type IncidentWorkflowRun,
  type WorkflowDefinitionSummary,
} from '@/lib/builderforceApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const SEVERITIES: IncidentSeverity[] = ['sev1', 'sev2', 'sev3', 'sev4'];
const SEVERITY_BADGE: Record<IncidentSeverity, string> = {
  sev1: 'badge-red',
  sev2: 'badge-orange',
  sev3: 'badge-amber',
  sev4: 'badge-blue',
};
const STATUS_BADGE: Record<IncidentStatus, string> = {
  open: 'badge-red',
  acknowledged: 'badge-amber',
  mitigated: 'badge-blue',
  resolved: 'badge-green',
};
const ROTATION_KINDS: RotationKind[] = ['manual', 'daily', 'weekly'];
const TARGET_KINDS: EscalationTargetKind[] = ['oncall_rotation', 'user', 'contact', 'team_chat'];

function fmt(dt: string | null | undefined): string {
  if (!dt) return '—';
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** Split a free-text RCA field into discrete causes — one per line / semicolon. */
function splitCauses(s: string | null | undefined): string[] {
  return (s ?? '')
    .split(/[\n;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function IncidentsPageClient() {
  const t = useTranslations('incidents');
  const tm = useTranslations('monitoring');
  const tc = useTranslations('common');
  const tab = useSearchParams().get('tab') ?? '';
  const role = useRole();
  const canManage = hasMinRole(role, 'manager');

  const heading = tab === 'monitors'
    ? { title: tm('boardsTitle'), subtitle: tm('boardsSubtitle') }
    : tab === 'reporting'
      ? { title: tm('reportingTitle'), subtitle: tm('reportingSubtitle') }
      : tab === 'oncall'
        ? { title: t('tab.oncall'), subtitle: t('oncallSubtitle') }
        : tab === 'escalation'
          ? { title: t('tab.escalation'), subtitle: t('escalationSubtitle') }
          : tab === 'contacts'
            ? { title: t('tab.contacts'), subtitle: t('contactsSubtitle') }
            : { title: t('title'), subtitle: t('subtitle') };

  return (
    <PageContainer>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>{heading.title}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0, maxWidth: 640 }}>{heading.subtitle}</p>
      </div>

      {tab === 'monitors' ? (
        <MonitorsSection />
      ) : tab === 'reporting' ? (
        <MonitoringReporting />
      ) : tab === 'oncall' ? (
        <OnCallSection t={t} tc={tc} canManage={canManage} />
      ) : tab === 'escalation' ? (
        <EscalationSection t={t} tc={tc} canManage={canManage} />
      ) : tab === 'contacts' ? (
        <ContactsSection t={t} tc={tc} canManage={canManage} />
      ) : (
        <IncidentsSection t={t} tc={tc} canManage={canManage} />
      )}
    </PageContainer>
  );
}

type T = ReturnType<typeof useTranslations>;
interface SectionProps { t: T; tc: T; canManage: boolean; }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}

function Loader({ t }: { t: T }) {
  return <div style={{ ...card, color: 'var(--text-muted)' }}>{t('loading')}</div>;
}
function ErrorCard({ msg }: { msg: string }) {
  return <div style={{ ...card, borderColor: 'var(--danger, #e5484d)', color: 'var(--danger, #e5484d)' }}>{msg}</div>;
}
function EmptyCard({ msg }: { msg: string }) {
  return <div style={{ ...card, color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>{msg}</div>;
}

/* ─────────────────────────── Incidents ─────────────────────────── */

function IncidentsSection({ t, tc, canManage }: SectionProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    incidentsApi.list(activeOnly)
      .then(setIncidents)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activeOnly]);

  useEffect(() => { load(); }, [load]);

  // Deep-link: /incidents?incident=<id> opens that incident's detail panel directly, so
  // a monitor breach / reporting row can jump straight to its incident (not just the list).
  const deepLinkIncidentId = useSearchParams().get('incident');
  useEffect(() => { if (deepLinkIncidentId) setSelectedId(deepLinkIncidentId); }, [deepLinkIncidentId]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          {t('activeOnly')}
        </label>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)} disabled={!canManage} title={canManage ? undefined : t('needManager')}>
          {t('newIncident')}
        </button>
      </div>

      {loading && <Loader t={tc} />}
      {error && <ErrorCard msg={error} />}
      {!loading && !error && (incidents.length === 0
        ? <EmptyCard msg={t('emptyIncidents')} />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {incidents.map((inc) => (
              <button
                key={inc.id}
                type="button"
                onClick={() => setSelectedId(inc.id)}
                style={{ ...card, cursor: 'pointer', textAlign: 'left', width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={SEVERITY_BADGE[inc.severity]}>{t(`severity.${inc.severity}`)}</span>
                  <span className={STATUS_BADGE[inc.status]}>{t(`status.${inc.status}`)}</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15, flex: 1, minWidth: 0 }}>{inc.title}</span>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>{t('colSystem')}: {inc.affectedSystem || '—'}</span>
                  <span>{t('colStarted')}: {fmt(inc.startedAt)}</span>
                  <span>{t('escalationLevel', { level: inc.escalationLevel })}</span>
                </div>
              </button>
            ))}
          </div>
        )
      )}

      {selectedId && (
        <IncidentDetailPanel
          t={t}
          tc={tc}
          canManage={canManage}
          incidentId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}

      <CreateIncidentPanel
        t={t}
        tc={tc}
        canManage={canManage}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); load(); }}
      />
    </>
  );
}

function CreateIncidentPanel({ t, tc, canManage, open, onClose, onCreated }: SectionProps & { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('sev3');
  const [affectedSystem, setAffectedSystem] = useState('');
  const [openWarRoom, setOpenWarRoom] = useState(false);
  const [page, setPage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(''); setDescription(''); setSeverity('sev3'); setAffectedSystem('');
      setOpenWarRoom(false); setPage(false); setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!title.trim()) { setError(t('validationTitle')); return; }
    setSaving(true); setError(null);
    try {
      await incidentsApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        severity,
        affectedSystem: affectedSystem.trim() || undefined,
        openWarRoom,
        page,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('newIncident')}>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <ErrorCard msg={error} />}
        <Field label={t('fieldTitle')}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('titlePlaceholder')} />
        </Field>
        <Field label={t('fieldDescription')}>
          <textarea className="input" style={{ minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('descriptionPlaceholder')} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <Field label={t('fieldSeverity')}>
            <Select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{t(`severity.${s}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('fieldSystem')}>
            <input className="input" value={affectedSystem} onChange={(e) => setAffectedSystem(e.target.value)} placeholder={t('systemPlaceholder')} />
          </Field>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={openWarRoom} onChange={(e) => setOpenWarRoom(e.target.checked)} />
          {t('openWarRoomCheck')}
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={page} onChange={(e) => setPage(e.target.checked)} />
          {t('pageOnCallCheck')}
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving || !canManage}>
            {saving ? tc('saving') : t('create')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>{tc('cancel')}</button>
        </div>
      </div>
    </SlideOutPanel>
  );
}

function IncidentDetailPanel({ t, tc, canManage, incidentId, onClose, onChanged }: SectionProps & { incidentId: string; onClose: () => void; onChanged: () => void }) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [timeline, setTimeline] = useState<IncidentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [classifyValue, setClassifyValue] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    incidentsApi.get(incidentId)
      .then(({ incident, timeline }) => { setIncident(incident); setTimeline(timeline); setClassifyValue(incident.affectedSystem ?? ''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [incidentId]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => unknown) => {
    setBusy(true); setError(null);
    try { await fn(); load(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  };

  const actionBtn = (label: string, fn: () => unknown, primary = false) => (
    <button type="button" className={primary ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'} disabled={busy || !canManage} onClick={() => run(fn)}>
      {label}
    </button>
  );

  return (
    <SlideOutPanel open onClose={onClose} title={incident ? `${t('warRoomTitle')} — ${incident.title}` : t('warRoomTitle')} width="min(680px, 96vw)">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading && <Loader t={tc} />}
        {error && <ErrorCard msg={error} />}
        {incident && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className={SEVERITY_BADGE[incident.severity]}>{t(`severity.${incident.severity}`)}</span>
              <span className={STATUS_BADGE[incident.status]}>{t(`status.${incident.status}`)}</span>
              <span className="badge-muted">{t('escalationLevel', { level: incident.escalationLevel })}</span>
            </div>

            {/* Fields */}
            <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <DetailRow label={t('colSystem')} value={incident.affectedSystem || '—'} />
              <DetailRow label={t('colSource')} value={incident.source || '—'} />
              <DetailRow label={t('startedAt')} value={fmt(incident.startedAt)} />
              <DetailRow label={t('acknowledgedAt')} value={fmt(incident.acknowledgedAt)} />
              <DetailRow label={t('resolvedAt')} value={fmt(incident.resolvedAt)} />
              <DetailRow label={t('impact')} value={incident.impact || '—'} />
              <DetailRow label={t('rootCause')} value={incident.rootCause || '—'} />
            </div>

            {/* Why did this occur? — fishbone RCA (renders once a root cause is known) */}
            {incident.rootCause && (() => {
              const categories: FishboneCategory[] = [
                { label: t('rca.rootCause'), causes: splitCauses(incident.rootCause) },
                ...(incident.impact ? [{ label: t('rca.impact'), causes: splitCauses(incident.impact) }] : []),
              ];
              return (
                <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('rca.fishTitle')}</div>
                  <FishboneChart problem={incident.title} categories={categories} ariaLabel={t('rca.fishAria', { title: incident.title })} />
                </div>
              );
            })()}

            {/* Actions */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>{t('actions')}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {incident.status !== 'resolved' && actionBtn(t('acknowledge'), () => incidentsApi.update(incident.id, { status: 'acknowledged' }))}
                {incident.status !== 'resolved' && actionBtn(t('resolve'), () => incidentsApi.update(incident.id, { status: 'resolved' }), true)}
                {actionBtn(t('pageOncall'), () => incidentsApi.page(incident.id))}
                {actionBtn(t('openWarRoom'), () => incidentsApi.warRoom(incident.id))}
                {actionBtn(t('runTriage'), () => incidentsApi.triage(incident.id))}
              </div>
            </div>

            {/* RCA / post-mortem */}
            <RcaSection t={t} tc={tc} canManage={canManage} incident={incident} onPublished={() => { load(); onChanged(); }} />

            {/* Implicated delivery tickets + their accountability (RCA linkage, §5.10) */}
            <ImplicatedTicketsSection t={t} canManage={canManage} incidentId={incident.id} />

            {/* Runbooks — run a custom workflow against this incident + linked runs */}
            <WorkflowRunsSection t={t} tc={tc} canManage={canManage} incidentId={incident.id} />

            {/* Classify */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <Field label={t('classifySystem')}>
                  <input className="input" value={classifyValue} onChange={(e) => setClassifyValue(e.target.value)} placeholder={t('systemPlaceholder')} />
                </Field>
              </div>
              {actionBtn(t('classify'), () => incidentsApi.classify(incident.id, classifyValue.trim()))}
            </div>

            {/* Add note */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <Field label={t('addNote')}>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} />
                </Field>
              </div>
              {actionBtn(t('addNoteBtn'), async () => { if (note.trim()) { await incidentsApi.addNote(incident.id, note.trim()); setNote(''); } })}
            </div>

            {/* Timeline */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>{t('timeline')}</div>
              {timeline.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noEvents')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {timeline.map((ev) => (
                    <div key={ev.id} style={{ display: 'flex', gap: 10, fontSize: 13, borderLeft: '2px solid var(--border-subtle)', paddingLeft: 10 }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmt(ev.createdAt)}</span>
                      <span style={{ color: 'var(--text-primary)' }}>
                        <strong style={{ fontWeight: 600 }}>{ev.kind}</strong>
                        {ev.message ? ` — ${ev.message}` : ''}
                        {ev.actorRef ? ` (${ev.actorRef})` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </SlideOutPanel>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

/* ────────────── Implicated tickets + accountability (RCA linkage) ────────────── */

function ImplicatedTicketsSection({ t, canManage, incidentId }: { t: T; canManage: boolean; incidentId: string }) {
  const [rows, setRows] = useState<ImplicatedTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [addId, setAddId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    incidentsApi.implicated(incidentId).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [incidentId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const taskId = Number(addId.trim());
    if (!Number.isFinite(taskId) || taskId <= 0) return;
    setBusy(true);
    try { await incidentsApi.linkImplicated(incidentId, { taskId }); setAddId(''); load(); } finally { setBusy(false); }
  };
  const remove = async (taskId: number) => { setBusy(true); try { await incidentsApi.unlinkImplicated(incidentId, taskId); load(); } finally { setBusy(false); } };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('implicated.title')}</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('implicated.help')}</p>
      {loading ? (
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('implicated.loading')}</span>
      ) : rows.length === 0 ? (
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('implicated.empty')}</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => {
            const a = r.accountability;
            const complete = a.percentComplete >= 100;
            return (
              <div key={r.taskId} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>#{r.taskId} {r.title}</span>
                  <span className="badge-muted">{r.status}</span>
                  <div style={{ flex: 1 }} />
                  {canManage && (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => remove(r.taskId)}>{t('implicated.remove')}</button>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 100, height: 6, borderRadius: 999, background: 'var(--bg-deep, #e2e8f0)', overflow: 'hidden' }}>
                    <div style={{ width: `${a.percentComplete}%`, height: '100%', background: complete ? 'var(--success, #16a34a)' : 'var(--coral-bright, #f97316)' }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('implicated.signed', { done: a.completedCount, total: a.requiredCount })}</span>
                </div>
                {a.gaps.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--danger-text, #991b1b)' }}>{t('implicated.gaps', { count: a.gaps.length })}: {a.gaps.map((g) => g.roleName).join(', ')}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {canManage && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" style={{ maxWidth: 160 }} value={addId} onChange={(e) => setAddId(e.target.value)} placeholder={t('implicated.addPlaceholder')} inputMode="numeric" />
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !addId.trim()} onClick={add}>{t('implicated.add')}</button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── RCA / post-mortem ─────────────────────── */

const RCA_DOC_TYPES: PostmortemDocType[] = ['postmortem', 'known_error'];
type ActionItemDraft = { title: string; detail: string };

function RcaSection({ t, tc, canManage, incident, onPublished }: SectionProps & { incident: Incident; onPublished: () => void }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [rootCause, setRootCause] = useState(incident.rootCause ?? '');
  const [impact, setImpact] = useState(incident.impact ?? '');
  const [contributingFactors, setContributingFactors] = useState('');
  const [resolution, setResolution] = useState('');
  const [whatWentWell, setWhatWentWell] = useState('');
  const [whatWentWrong, setWhatWentWrong] = useState('');
  const [docType, setDocType] = useState<PostmortemDocType>('postmortem');
  const [actionItems, setActionItems] = useState<ActionItemDraft[]>([{ title: '', detail: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already published — offer the read link.
  if (incident.postmortemUrl) {
    return (
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>{t('rca.publishedNote')}</span>
        <a href={incident.postmortemUrl} className="btn btn-secondary btn-sm">{t('rca.view')}</a>
      </div>
    );
  }

  // Only resolved incidents without a post-mortem can publish one.
  if (incident.status !== 'resolved') return null;

  if (!open) {
    return (
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>{t('rca.prompt')}</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)} disabled={!canManage} title={canManage ? undefined : t('needManager')}>
          {t('rca.publish')}
        </button>
      </div>
    );
  }

  const setItem = (i: number, patch: Partial<ActionItemDraft>) =>
    setActionItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setActionItems((prev) => [...prev, { title: '', detail: '' }]);
  const removeItem = (i: number) => setActionItems((prev) => {
    if (prev.length <= 1) return prev;
    return prev.filter((_, idx) => idx !== i);
  });

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const items = actionItems
        .map((it) => ({ title: it.title.trim(), detail: it.detail.trim() || undefined }))
        .filter((it) => it.title.length > 0);
      await incidentsApi.publishPostmortem(incident.id, {
        summary: summary.trim() || undefined,
        rootCause: rootCause.trim() || undefined,
        impact: impact.trim() || undefined,
        contributingFactors: contributingFactors.trim() || undefined,
        resolution: resolution.trim() || undefined,
        whatWentWell: whatWentWell.trim() || undefined,
        whatWentWrong: whatWentWrong.trim() || undefined,
        docType,
        actionItems: items.length ? items : undefined,
      });
      onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('rca.formTitle')}</div>
      {error && <ErrorCard msg={error} />}

      <Field label={t('rca.docType.label')}>
        <Select className="input" value={docType} onChange={(e) => setDocType(e.target.value as PostmortemDocType)}>
          {RCA_DOC_TYPES.map((d) => <option key={d} value={d}>{t(`rca.docType.${d}`)}</option>)}
        </Select>
      </Field>

      <Field label={t('rca.summary')}>
        <textarea className="input" style={{ minHeight: 60 }} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t('rca.summaryPlaceholder')} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <Field label={t('rca.rootCause')}>
          <textarea className="input" style={{ minHeight: 60 }} value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
        </Field>
        <Field label={t('rca.impact')}>
          <textarea className="input" style={{ minHeight: 60 }} value={impact} onChange={(e) => setImpact(e.target.value)} />
        </Field>
        <Field label={t('rca.contributingFactors')}>
          <textarea className="input" style={{ minHeight: 60 }} value={contributingFactors} onChange={(e) => setContributingFactors(e.target.value)} />
        </Field>
        <Field label={t('rca.resolution')}>
          <textarea className="input" style={{ minHeight: 60 }} value={resolution} onChange={(e) => setResolution(e.target.value)} />
        </Field>
        <Field label={t('rca.whatWentWell')}>
          <textarea className="input" style={{ minHeight: 60 }} value={whatWentWell} onChange={(e) => setWhatWentWell(e.target.value)} />
        </Field>
        <Field label={t('rca.whatWentWrong')}>
          <textarea className="input" style={{ minHeight: 60 }} value={whatWentWrong} onChange={(e) => setWhatWentWrong(e.target.value)} />
        </Field>
      </div>

      {/* Live "why did this occur?" fishbone — updates as the RCA is written */}
      {(rootCause.trim() || contributingFactors.trim() || whatWentWrong.trim() || impact.trim()) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{t('rca.fishTitle')}</span>
          <FishboneChart
            problem={incident.title}
            ariaLabel={t('rca.fishAria', { title: incident.title })}
            categories={[
              { label: t('rca.rootCause'), causes: splitCauses(rootCause) },
              { label: t('rca.contributingFactors'), causes: splitCauses(contributingFactors) },
              { label: t('rca.whatWentWrong'), causes: splitCauses(whatWentWrong) },
              { label: t('rca.impact'), causes: splitCauses(impact) },
            ].filter((c) => c.causes.length > 0)}
          />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{t('rca.actionItems')}</span>
        {actionItems.map((it, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: 2, minWidth: 160 }}
              value={it.title}
              onChange={(e) => setItem(i, { title: e.target.value })}
              placeholder={t('rca.actionItemTitle')}
            />
            <input
              className="input"
              style={{ flex: 3, minWidth: 160 }}
              value={it.detail}
              onChange={(e) => setItem(i, { detail: e.target.value })}
              placeholder={t('rca.actionItemDetail')}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeItem(i)} disabled={actionItems.length <= 1} aria-label={t('rca.removeActionItem')}>✕</button>
          </div>
        ))}
        <div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>{t('rca.addActionItem')}</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={saving || !canManage}>
          {saving ? tc('saving') : t('rca.submit')}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)} disabled={saving}>{tc('cancel')}</button>
      </div>
    </div>
  );
}

/* ─────────────────── Runbooks — custom workflows on an incident ─────────────────── */

function WorkflowRunsSection({ t, tc, canManage, incidentId }: SectionProps & { incidentId: string }) {
  const [defs, setDefs] = useState<WorkflowDefinitionSummary[]>([]);
  const [runs, setRuns] = useState<IncidentWorkflowRun[]>([]);
  const [selectedDef, setSelectedDef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(() => {
    incidentsApi.listWorkflowRuns(incidentId).then(setRuns).catch(() => {});
  }, [incidentId]);

  useEffect(() => {
    workflowDefinitions.list().then(setDefs).catch(() => {});
    loadRuns();
  }, [loadRuns]);

  const runWorkflow = async () => {
    if (!selectedDef) return;
    setBusy(true); setError(null);
    try {
      await incidentsApi.runWorkflow(incidentId, { definitionId: selectedDef });
      setSelectedDef('');
      loadRuns();
    } catch (e) { setError(e instanceof Error ? e.message : 'Run failed'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('workflows.title')}</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('workflows.blurb')}</p>
      {error && <ErrorCard msg={error} />}

      {canManage && defs.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <Field label={t('workflows.pick')}>
              <Select className="input" value={selectedDef} onChange={(e) => setSelectedDef(e.target.value)}>
                <option value="">{t('workflows.pickPlaceholder')}</option>
                {defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={runWorkflow} disabled={busy || !selectedDef}>
            {busy ? tc('saving') : t('workflows.run')}
          </button>
        </div>
      )}
      {defs.length === 0 && (
        <a href="/workflows" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>{t('workflows.create')}</a>
      )}

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>{t('workflows.runs')}</div>
        {runs.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('workflows.noRuns')}</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {runs.map((r) => (
                <a key={r.id} href="/workflows" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', textDecoration: 'none', fontSize: 12 }}>
                  <span className="badge-muted">{r.status}</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{r.definitionName || r.description || r.id}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{fmt(r.createdAt)}</span>
                </a>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

/* ─────────────────────────── On-call ─────────────────────────── */

function OnCallSection({ t, tc, canManage }: SectionProps) {
  const confirm = useConfirm();
  const [rotations, setRotations] = useState<OnCallRotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rotationKind, setRotationKind] = useState<RotationKind>('manual');
  const [saving, setSaving] = useState(false);

  // Add-member draft, keyed by rotation id
  const [memberDraft, setMemberDraft] = useState<Record<string, { displayName: string; memberRef: string }>>({});

  const load = useCallback(() => {
    setLoading(true); setError(null);
    incidentsApi.listRotations()
      .then(setRotations)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const createRotation = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await incidentsApi.createRotation({ name: name.trim(), description: description.trim() || undefined, rotationKind });
      setCreateOpen(false); setName(''); setDescription(''); setRotationKind('manual');
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed'); }
    finally { setSaving(false); }
  };

  const removeRotation = async (r: OnCallRotation) => {
    if (!(await confirm({ message: t('deleteRotationConfirm', { name: r.name }), destructive: true }))) return;
    try { await incidentsApi.removeRotation(r.id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };

  const addMember = async (r: OnCallRotation) => {
    const d = memberDraft[r.id];
    if (!d?.memberRef.trim()) return;
    try {
      await incidentsApi.addRotationMember(r.id, { memberRef: d.memberRef.trim(), displayName: d.displayName.trim() || undefined });
      setMemberDraft((prev) => ({ ...prev, [r.id]: { displayName: '', memberRef: '' } }));
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Add failed'); }
  };

  const removeMember = async (r: OnCallRotation, memberId: string) => {
    if (!(await confirm({ message: t('deleteMemberConfirm'), destructive: true }))) return;
    try { await incidentsApi.removeRotationMember(r.id, memberId); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)} disabled={!canManage} title={canManage ? undefined : t('needManager')}>
          {t('newRotation')}
        </button>
      </div>

      {loading && <Loader t={tc} />}
      {error && <ErrorCard msg={error} />}
      {!loading && !error && (rotations.length === 0
        ? <EmptyCard msg={t('emptyRotations')} />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rotations.map((r) => {
              const d = memberDraft[r.id] ?? { displayName: '', memberRef: '' };
              return (
                <div key={r.id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{r.name}</span>
                    <span className="badge-muted">{t(`rotationKind.${r.rotationKind}`)}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {t('currentlyOnCall')}: <strong style={{ color: 'var(--text-primary)' }}>{r.onCall ? (r.onCall.displayName || r.onCall.memberRef) : t('noOneOnCall')}</strong>
                    </span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeRotation(r)} disabled={!canManage}>{tc('delete')}</button>
                  </div>
                  {r.description && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{r.description}</div>}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{t('members')}</span>
                    {r.members.length === 0
                      ? <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noMembers')}</span>
                      : r.members.map((m) => (
                        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <span style={{ color: 'var(--text-primary)' }}>{m.displayName || m.memberRef}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{m.memberRef}</span>
                          <span style={{ flex: 1 }} />
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeMember(r, m.id)} disabled={!canManage} aria-label={t('removeMember')}>✕</button>
                        </div>
                      ))}
                  </div>

                  {canManage && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <Field label={t('memberDisplayName')}>
                          <input className="input" value={d.displayName} onChange={(e) => setMemberDraft((p) => ({ ...p, [r.id]: { ...d, displayName: e.target.value } }))} />
                        </Field>
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <Field label={t('memberRef')}>
                          <input className="input" value={d.memberRef} onChange={(e) => setMemberDraft((p) => ({ ...p, [r.id]: { ...d, memberRef: e.target.value } }))} placeholder={t('memberRefPlaceholder')} />
                        </Field>
                      </div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => addMember(r)}>{t('addMember')}</button>
                    </div>
                  )}
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>{t('memberRefHelp')}</p>
                </div>
              );
            })}
          </div>
        )
      )}

      <SlideOutPanel open={createOpen} onClose={() => setCreateOpen(false)} title={t('newRotation')}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label={t('rotationName')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('rotationDescription')}>
            <textarea className="input" style={{ minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label={t('rotationKindLabel')}>
            <Select className="input" value={rotationKind} onChange={(e) => setRotationKind(e.target.value as RotationKind)}>
              {ROTATION_KINDS.map((k) => <option key={k} value={k}>{t(`rotationKind.${k}`)}</option>)}
            </Select>
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn-primary" onClick={createRotation} disabled={saving || !canManage}>{saving ? tc('saving') : t('createRotation')}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>{tc('cancel')}</button>
          </div>
        </div>
      </SlideOutPanel>
    </>
  );
}

/* ─────────────────────────── Escalation ─────────────────────────── */

function EscalationSection({ t, tc, canManage }: SectionProps) {
  const confirm = useConfirm();
  const [policies, setPolicies] = useState<EscalationPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [matchSeverity, setMatchSeverity] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Add-level draft keyed by policy id
  const [levelDraft, setLevelDraft] = useState<Record<string, { afterMinutes: string; targetKind: EscalationTargetKind; targetRef: string; notifyTeams: boolean; notifySlack: boolean; notifyEmail: boolean }>>({});
  const emptyLevel = { afterMinutes: '5', targetKind: 'oncall_rotation' as EscalationTargetKind, targetRef: '', notifyTeams: false, notifySlack: false, notifyEmail: true };

  const load = useCallback(() => {
    setLoading(true); setError(null);
    incidentsApi.listPolicies()
      .then(setPolicies)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const createPolicy = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await incidentsApi.createPolicy({
        name: name.trim(),
        description: description.trim() || undefined,
        matchSeverity: matchSeverity ? (matchSeverity as IncidentSeverity) : undefined,
      });
      setCreateOpen(false); setName(''); setDescription(''); setMatchSeverity('');
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed'); }
    finally { setSaving(false); }
  };

  const removePolicy = async (p: EscalationPolicy) => {
    if (!(await confirm({ message: t('deletePolicyConfirm', { name: p.name }), destructive: true }))) return;
    try { await incidentsApi.removePolicy(p.id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };

  const addLevel = async (p: EscalationPolicy) => {
    const d = levelDraft[p.id] ?? emptyLevel;
    const mins = Number(d.afterMinutes);
    if (Number.isNaN(mins)) return;
    try {
      await incidentsApi.addPolicyLevel(p.id, {
        afterMinutes: mins,
        targetKind: d.targetKind,
        targetRef: d.targetRef.trim() || undefined,
        notifyTeams: d.notifyTeams,
        notifySlack: d.notifySlack,
        notifyEmail: d.notifyEmail,
      });
      setLevelDraft((prev) => ({ ...prev, [p.id]: emptyLevel }));
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Add failed'); }
  };

  const removeLevel = async (levelId: string) => {
    if (!(await confirm({ message: t('deleteLevelConfirm'), destructive: true }))) return;
    try { await incidentsApi.removeLevel(levelId); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };

  const channelsLabel = (lv: EscalationPolicy['levels'][number]) => {
    const ch: string[] = [];
    if (lv.notifyTeams) ch.push(t('notifyTeams'));
    if (lv.notifySlack) ch.push(t('notifySlack'));
    if (lv.notifyEmail) ch.push(t('notifyEmail'));
    return ch.join(', ') || '—';
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)} disabled={!canManage} title={canManage ? undefined : t('needManager')}>
          {t('newPolicy')}
        </button>
      </div>

      {loading && <Loader t={tc} />}
      {error && <ErrorCard msg={error} />}
      {!loading && !error && (policies.length === 0
        ? <EmptyCard msg={t('emptyPolicies')} />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {policies.map((p) => {
              const d = levelDraft[p.id] ?? emptyLevel;
              return (
                <div key={p.id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{p.name}</span>
                    <span className="badge-muted">{p.matchSeverity ? t(`severity.${p.matchSeverity}`) : t('anySeverity')}</span>
                    <span style={{ flex: 1 }} />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => removePolicy(p)} disabled={!canManage}>{tc('delete')}</button>
                  </div>
                  {p.description && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{p.description}</div>}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{t('levels')}</span>
                    {p.levels.length === 0
                      ? <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noLevels')}</span>
                      : [...p.levels].sort((a, b) => a.level - b.level).map((lv) => (
                        <div key={lv.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <span style={{ color: 'var(--text-primary)' }}>
                            {t('levelRule', {
                              minutes: lv.afterMinutes,
                              target: `${t(`targetKind.${lv.targetKind}`)}${lv.targetRef ? ` (${lv.targetRef})` : ''}`,
                              channels: channelsLabel(lv),
                            })}
                          </span>
                          <span style={{ flex: 1 }} />
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeLevel(lv.id)} disabled={!canManage} aria-label={t('removeLevel')}>✕</button>
                        </div>
                      ))}
                  </div>

                  {canManage && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                      <div style={{ width: 110 }}>
                        <Field label={t('afterMinutes')}>
                          <input className="input" type="number" min={0} value={d.afterMinutes} onChange={(e) => setLevelDraft((prev) => ({ ...prev, [p.id]: { ...d, afterMinutes: e.target.value } }))} />
                        </Field>
                      </div>
                      <div style={{ minWidth: 150 }}>
                        <Field label={t('targetKind_')}>
                          <Select className="input" value={d.targetKind} onChange={(e) => setLevelDraft((prev) => ({ ...prev, [p.id]: { ...d, targetKind: e.target.value as EscalationTargetKind } }))}>
                            {TARGET_KINDS.map((k) => <option key={k} value={k}>{t(`targetKind.${k}`)}</option>)}
                          </Select>
                        </Field>
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <Field label={t('targetRef')}>
                          <input className="input" value={d.targetRef} onChange={(e) => setLevelDraft((prev) => ({ ...prev, [p.id]: { ...d, targetRef: e.target.value } }))} />
                        </Field>
                      </div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
                        <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={d.notifyTeams} onChange={(e) => setLevelDraft((prev) => ({ ...prev, [p.id]: { ...d, notifyTeams: e.target.checked } }))} />{t('notifyTeams')}</label>
                        <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={d.notifySlack} onChange={(e) => setLevelDraft((prev) => ({ ...prev, [p.id]: { ...d, notifySlack: e.target.checked } }))} />{t('notifySlack')}</label>
                        <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={d.notifyEmail} onChange={(e) => setLevelDraft((prev) => ({ ...prev, [p.id]: { ...d, notifyEmail: e.target.checked } }))} />{t('notifyEmail')}</label>
                      </div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => addLevel(p)}>{t('addLevel')}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      <SlideOutPanel open={createOpen} onClose={() => setCreateOpen(false)} title={t('newPolicy')}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label={t('policyName')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('policyDescription')}>
            <textarea className="input" style={{ minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label={t('matchSeverity')}>
            <Select className="input" value={matchSeverity} onChange={(e) => setMatchSeverity(e.target.value)}>
              <option value="">{t('anySeverity')}</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{t(`severity.${s}`)}</option>)}
            </Select>
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn-primary" onClick={createPolicy} disabled={saving || !canManage}>{saving ? tc('saving') : t('createPolicy')}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>{tc('cancel')}</button>
          </div>
        </div>
      </SlideOutPanel>
    </>
  );
}

/* ─────────────────────────── Contacts ─────────────────────────── */

const EMPTY_CONTACT = { name: '', roleTitle: '', company: '', email: '', phone: '', teamsId: '', notes: '' };

function ContactsSection({ t, tc, canManage }: SectionProps) {
  const confirm = useConfirm();
  const [contacts, setContacts] = useState<BusinessContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<BusinessContact | null>(null);
  const [draft, setDraft] = useState(EMPTY_CONTACT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    incidentsApi.listContacts()
      .then(setContacts)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setDraft(EMPTY_CONTACT); setPanelOpen(true); };
  const openEdit = (c: BusinessContact) => {
    setEditing(c);
    setDraft({ name: c.name, roleTitle: c.roleTitle ?? '', company: c.company ?? '', email: c.email ?? '', phone: c.phone ?? '', teamsId: c.teamsId ?? '', notes: c.notes ?? '' });
    setPanelOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) { setError(t('validationName')); return; }
    setSaving(true); setError(null);
    try {
      if (editing) await incidentsApi.updateContact(editing.id, draft);
      else await incidentsApi.createContact({ ...draft, name: draft.name.trim() });
      setPanelOpen(false); load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  const remove = async (c: BusinessContact) => {
    if (!(await confirm({ message: t('deleteContactConfirm', { name: c.name }), destructive: true }))) return;
    try { await incidentsApi.removeContact(c.id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button type="button" className="btn btn-primary" onClick={openCreate} disabled={!canManage} title={canManage ? undefined : t('needManager')}>
          {t('newContact')}
        </button>
      </div>

      {loading && <Loader t={tc} />}
      {error && <ErrorCard msg={error} />}
      {!loading && !error && (contacts.length === 0
        ? <EmptyCard msg={t('emptyContacts')} />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {contacts.map((c) => (
              <div key={c.id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{c.name}</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(c)} disabled={!canManage}>{tc('edit')}</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => remove(c)} disabled={!canManage}>{tc('delete')}</button>
                </div>
                {(c.roleTitle || c.company) && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{[c.roleTitle, c.company].filter(Boolean).join(' · ')}</div>}
                {c.email && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.email}</div>}
                {c.phone && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.phone}</div>}
                {c.teamsId && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Teams: {c.teamsId}</div>}
                {c.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{c.notes}</div>}
              </div>
            ))}
          </div>
        )
      )}

      <SlideOutPanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editing ? t('editContact') : t('newContact')}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <ErrorCard msg={error} />}
          <Field label={t('contactName')}>
            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Field label={t('contactRole')}>
              <input className="input" value={draft.roleTitle} onChange={(e) => setDraft({ ...draft, roleTitle: e.target.value })} />
            </Field>
            <Field label={t('contactCompany')}>
              <input className="input" value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Field label={t('contactEmail')}>
              <input className="input" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </Field>
            <Field label={t('contactPhone')}>
              <input className="input" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </Field>
          </div>
          <Field label={t('contactTeamsId')}>
            <input className="input" value={draft.teamsId} onChange={(e) => setDraft({ ...draft, teamsId: e.target.value })} />
          </Field>
          <Field label={t('contactNotes')}>
            <textarea className="input" style={{ minHeight: 70 }} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !canManage}>{saving ? tc('saving') : tc('save')}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setPanelOpen(false)}>{tc('cancel')}</button>
          </div>
        </div>
      </SlideOutPanel>
    </>
  );
}
