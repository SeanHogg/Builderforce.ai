'use client';

/**
 * MonitoringSections — the Active Monitoring surface, extracted from the old
 * standalone /monitoring page so it can live as tabs of the consolidated
 * Reliability destination (/incidents?tab=monitors|reporting) AND be reused
 * anywhere else. Two self-contained exports:
 *   • <MonitorsSection/>     — the Boards canvas (uploaded diagram + monitor pins;
 *                              a breach opens an incident).
 *   • <MonitoringReporting/> — the incident + monitor metric roll-up.
 * Detail / create flows use the canonical <SlideOutPanel> (never a modal) and
 * destructive removals go through useConfirm(). Writes are gated to manager+
 * (mirrors the API requireRole(MANAGER)). Fully localized (monitoring namespace) +
 * theme-driven (never one-theme hex).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Select } from '@/components/Select';
import { useConfirm } from '@/components/ConfirmProvider';
import { useRole, hasMinRole } from '@/lib/rbac';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import {
  monitoringApi,
  incidentsApi,
  brain,
  type MonitoringBoard,
  type Monitor,
  type MonitorEvent,
  type MonitorType,
  type MonitorStatus,
  type MonitorMetric,
  type MonitorComparator,
  type MonitoringReport,
  type IncidentSeverity,
  type EscalationPolicy,
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
const MONITOR_TYPES: MonitorType[] = ['heartbeat', 'http_check', 'webhook', 'metric_threshold', 'manual'];
const METRICS: MonitorMetric[] = [
  'token_spend_usd',
  'token_spend_pct_of_cap',
  'cost_per_merged_pr_usd',
  'dora_change_failure_rate',
  'dora_lead_time_hours',
  'ai_effectiveness_score',
  'eval_drift',
];
const COMPARATORS: MonitorComparator[] = ['gt', 'lt', 'gte', 'lte'];

// Status → theme token colour for pins/badges. ok=success, breached=error,
// unknown=muted. All resolve in both light and dark themes.
const STATUS_COLOR: Record<MonitorStatus, { bg: string; fg: string }> = {
  ok: { bg: 'var(--success)', fg: 'var(--success-text)' },
  breached: { bg: 'var(--error)', fg: 'var(--error-text)' },
  unknown: { bg: 'var(--muted)', fg: 'var(--text-muted)' },
};

function fmt(dt: string | null | undefined): string {
  if (!dt) return '—';
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** Read an image's natural width/height client-side before upload. */
function readImageDims(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image load failed'));
    };
    img.src = url;
  });
}

type T = ReturnType<typeof useTranslations>;

/* ─────────────────────────── Public entry points ─────────────────────────── */

/** The Boards canvas — the default Monitors tab of the Reliability destination. */
export function MonitorsSection() {
  const t = useTranslations('monitoring');
  const tc = useTranslations('common');
  const role = useRole();
  const canManage = hasMinRole(role, 'manager');
  return (
    <>
      {/* Pulse animation for breached pins — defined once, theme-agnostic. */}
      <style>{`@keyframes bfMonitorPulse {0%{box-shadow:0 0 0 0 var(--error)}70%{box-shadow:0 0 0 8px rgba(0,0,0,0)}100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}}`}</style>
      <BoardsSection t={t} tc={tc} canManage={canManage} />
    </>
  );
}

/** The incident + monitor metric roll-up — the Reporting tab. */
export function MonitoringReporting() {
  const t = useTranslations('monitoring');
  return <ReportingSection t={t} />;
}

/* ─────────────────────────── Shared bits ─────────────────────────── */

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
  return <div style={{ ...card, borderColor: 'var(--error)', color: 'var(--error-text)' }}>{msg}</div>;
}
function EmptyCard({ msg }: { msg: string }) {
  return <div style={{ ...card, color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>{msg}</div>;
}

/* ─────────────────────────── Boards ─────────────────────────── */

function BoardsSection({ t, tc, canManage }: { t: T; tc: T; canManage: boolean }) {
  const [boards, setBoards] = useState<MonitoringBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    monitoringApi.listBoards()
      .then(setBoards)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const board = await monitoringApi.createBoard({ name: newName.trim() });
      setNewName('');
      load();
      setSelectedId(board.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  if (selectedId) {
    return (
      <BoardCanvas
        t={t}
        tc={tc}
        canManage={canManage}
        boardId={selectedId}
        onBack={() => { setSelectedId(null); load(); }}
      />
    );
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
          placeholder={t('boardNamePlaceholder')}
          style={{ flex: 1, minWidth: 180 }}
          disabled={!canManage}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={create}
          disabled={!canManage || creating || !newName.trim()}
          title={canManage ? undefined : t('needManager')}
        >
          {creating ? tc('saving') : t('newBoard')}
        </button>
      </div>

      {loading && <Loader t={t} />}
      {error && <ErrorCard msg={error} />}
      {!loading && !error && (boards.length === 0
        ? <EmptyCard msg={t('emptyBoards')} />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {boards.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedId(b.id)}
                style={{ ...card, cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, padding: 0, overflow: 'hidden' }}
              >
                <div style={{ height: 120, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {b.imageKey
                    ? <img src={brain.uploadUrl(b.imageKey)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 32, opacity: 0.4 }}>🗺️</span>}
                </div>
                <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15 }}>{b.name}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="badge-muted">{t('monitorsCount', { count: b.monitorCount })}</span>
                    {b.breachedCount > 0 && (
                      <span className="badge-red">{t('breachedCount', { count: b.breachedCount })}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )
      )}
    </>
  );
}

/* ─────────────────────────── Board canvas ─────────────────────────── */

function BoardCanvas({ t, tc, canManage, boardId, onBack }: { t: T; tc: T; canManage: boolean; boardId: string; onBack: () => void }) {
  const confirm = useConfirm();
  const [board, setBoard] = useState<MonitoringBoard | null>(null);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);
  const [draftPos, setDraftPos] = useState<{ posX: number; posY: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: string; moved: boolean } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    monitoringApi.getBoard(boardId)
      .then((r) => { setBoard(r.board); setMonitors(r.monitors); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [boardId]);

  useEffect(() => { load(); }, [load]);

  const handleImage = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    setError(null);
    try {
      const [{ key }, dims] = await Promise.all([brain.upload(file), readImageDims(file)]);
      await monitoringApi.updateBoard(boardId, { imageKey: key, imageWidth: dims.width, imageHeight: dims.height });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleImage(file);
    e.target.value = '';
  };

  const fractionalFromEvent = (clientX: number, clientY: number) => {
    const rect = imgWrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const posX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const posY = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return { posX, posY };
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    if (!addMode || !canManage) return;
    const pos = fractionalFromEvent(e.clientX, e.clientY);
    if (!pos) return;
    setDraftPos(pos);
    setSelectedMonitorId('new');
    setAddMode(false);
  };

  // Lightweight pin drag → updateMonitor(posX,posY) on drop. A pointer that
  // barely moves is treated as a click (opens the detail panel instead).
  const startDrag = (e: React.PointerEvent, m: Monitor) => {
    if (!canManage || addMode) return;
    e.stopPropagation();
    dragState.current = { id: m.id, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPinPointerMove = (e: React.PointerEvent, m: Monitor) => {
    const drag = dragState.current;
    if (!drag || drag.id !== m.id) return;
    const pos = fractionalFromEvent(e.clientX, e.clientY);
    if (!pos) return;
    drag.moved = true;
    setMonitors((prev) => prev.map((x) => x.id === m.id ? { ...x, posX: pos.posX, posY: pos.posY } : x));
  };
  const endDrag = async (e: React.PointerEvent, m: Monitor) => {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag || drag.id !== m.id) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!drag.moved) {
      setSelectedMonitorId(m.id);
      return;
    }
    const pos = fractionalFromEvent(e.clientX, e.clientY);
    if (!pos) { load(); return; }
    try {
      await monitoringApi.updateMonitor(m.id, { posX: pos.posX, posY: pos.posY });
    } catch {
      load();
    }
  };

  const removeBoard = async () => {
    if (!board) return;
    if (!(await confirm({ message: t('deleteBoardConfirm', { name: board.name }), destructive: true }))) return;
    try {
      await monitoringApi.deleteBoard(boardId);
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const aspect = board?.imageWidth && board?.imageHeight ? board.imageWidth / board.imageHeight : 16 / 9;

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-secondary" onClick={onBack}>← {t('backToBoards')}</button>
        <div style={{ flex: 1 }} />
        {board?.imageKey && (
          <button
            type="button"
            className={`btn ${addMode ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setAddMode((v) => !v)}
            disabled={!canManage}
            title={canManage ? undefined : t('needManager')}
          >
            {addMode ? t('exitAddMode') : t('addMonitor')}
          </button>
        )}
        {board?.imageKey && (
          <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={!canManage || uploading}>
            {uploading ? t('uploading') : t('changeImage')}
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={removeBoard} disabled={!canManage} style={{ color: 'var(--error-text)' }}>
          {tc('delete')}
        </button>
      </div>

      <input ref={fileRef} type="file" accept="image/*" onChange={onFilePick} style={{ display: 'none' }} />

      {loading && <Loader t={t} />}
      {error && <ErrorCard msg={error} />}

      {!loading && board && (
        <>
          {board.name && (
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px' }}>{board.name}</h2>
          )}
          {addMode && (
            <div style={{ ...card, marginBottom: 12, color: 'var(--text-secondary)', fontSize: 13 }}>{t('addMonitorHint')}</div>
          )}

          {!board.imageKey ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void handleImage(f); }}
              onDragOver={(e) => e.preventDefault()}
              disabled={!canManage || uploading}
              style={{
                ...card,
                width: '100%',
                minHeight: 220,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                cursor: canManage ? 'pointer' : 'not-allowed',
                borderStyle: 'dashed',
                color: 'var(--text-muted)',
              }}
            >
              <span style={{ fontSize: 40 }}>🖼️</span>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{uploading ? t('uploading') : t('uploadImage')}</span>
              <span style={{ fontSize: 12 }}>{t('dropImageHint')}</span>
            </button>
          ) : (
            <div
              ref={imgWrapRef}
              onClick={onCanvasClick}
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: 900,
                aspectRatio: String(aspect),
                borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid var(--border-subtle)',
                cursor: addMode ? 'crosshair' : 'default',
                userSelect: 'none',
                touchAction: 'none',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brain.uploadUrl(board.imageKey)} alt={board.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }} />
              {monitors.map((m) => (
                <MonitorPin
                  key={m.id}
                  monitor={m}
                  label={t(`status.${m.status}`)}
                  onPointerDown={(e) => startDrag(e, m)}
                  onPointerMove={(e) => onPinPointerMove(e, m)}
                  onPointerUp={(e) => void endDrag(e, m)}
                />
              ))}
            </div>
          )}

          {/* Compact list under the canvas for quick access / non-visual scan. */}
          {monitors.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {monitors.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedMonitorId(m.id)}
                  style={{ ...card, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[m.status].bg, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{m.label}</span>
                  <span className={SEVERITY_BADGE[m.severity]}>{t(`severity.${m.severity}`)}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t(`type.${m.monitorType}`)}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: STATUS_COLOR[m.status].fg }}>{t(`status.${m.status}`)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {selectedMonitorId && (
        <MonitorPanel
          t={t}
          tc={tc}
          canManage={canManage}
          boardId={boardId}
          monitorId={selectedMonitorId === 'new' ? null : selectedMonitorId}
          draftPos={selectedMonitorId === 'new' ? draftPos : null}
          onClose={() => { setSelectedMonitorId(null); setDraftPos(null); }}
          onChanged={() => { setSelectedMonitorId(null); setDraftPos(null); load(); }}
        />
      )}
    </>
  );
}

function MonitorPin({
  monitor,
  label,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  monitor: Monitor;
  label: string;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}) {
  const color = STATUS_COLOR[monitor.status];
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={monitor.label}
      style={{
        position: 'absolute',
        left: `${monitor.posX * 100}%`,
        top: `${monitor.posY * 100}%`,
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        zIndex: 2,
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: color.bg,
          border: '2px solid var(--bg-base)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          flexShrink: 0,
          animation: monitor.status === 'breached' ? 'bfMonitorPulse 1.6s infinite' : undefined,
        }}
      />
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--text-primary)',
          background: 'var(--bg-base)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 6,
          padding: '1px 6px',
          whiteSpace: 'nowrap',
          maxWidth: 140,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {monitor.label || label}
      </span>
    </div>
  );
}

/* ─────────────────────────── Monitor detail / config panel ─────────────────────────── */

function MonitorPanel({
  t, tc, canManage, boardId, monitorId, draftPos, onClose, onChanged,
}: {
  t: T; tc: T; canManage: boolean; boardId: string; monitorId: string | null;
  draftPos: { posX: number; posY: number } | null; onClose: () => void; onChanged: () => void;
}) {
  const confirm = useConfirm();
  const isNew = monitorId === null;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [signalUrl, setSignalUrl] = useState<string | null>(null);
  const [currentIncidentId, setCurrentIncidentId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [policies, setPolicies] = useState<EscalationPolicy[]>([]);

  // form fields
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [monitorType, setMonitorType] = useState<MonitorType>('heartbeat');
  const [affectedSystem, setAffectedSystem] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('sev3');
  const [escalationPolicyId, setEscalationPolicyId] = useState('');
  const [active, setActive] = useState(true);
  const [posX, setPosX] = useState(draftPos?.posX ?? 0.5);
  const [posY, setPosY] = useState(draftPos?.posY ?? 0.5);
  // type-specific config
  const [intervalSeconds, setIntervalSeconds] = useState('300');
  const [url, setUrl] = useState('');
  const [expectedStatus, setExpectedStatus] = useState('200');
  const [httpMethod, setHttpMethod] = useState('GET');
  const [httpHeadersText, setHttpHeadersText] = useState(''); // "Header: value" per line
  const [httpBodyMatch, setHttpBodyMatch] = useState('');
  const [metric, setMetric] = useState<MonitorMetric>('token_spend_usd');
  const [comparator, setComparator] = useState<MonitorComparator>('gt');
  const [threshold, setThreshold] = useState('');
  const [windowDays, setWindowDays] = useState('7');

  useEffect(() => {
    incidentsApi.listPolicies().then(setPolicies).catch(() => {});
  }, []);

  useEffect(() => {
    if (isNew || !monitorId) { setLoading(false); return; }
    setLoading(true);
    monitoringApi.getMonitor(monitorId)
      .then((r) => {
        const m = r.monitor;
        setLabel(m.label);
        setDescription(m.description ?? '');
        setMonitorType(m.monitorType);
        setAffectedSystem(m.affectedSystem ?? '');
        setSeverity(m.severity);
        setEscalationPolicyId(m.escalationPolicyId ?? '');
        setActive(m.active);
        setPosX(m.posX);
        setPosY(m.posY);
        const c = m.config ?? {};
        if (c.intervalSeconds != null) setIntervalSeconds(String(c.intervalSeconds));
        if (c.url != null) setUrl(String(c.url));
        if (c.expectedStatus != null) setExpectedStatus(String(c.expectedStatus));
        if (c.method != null) setHttpMethod(String(c.method).toUpperCase());
        if (c.headers && typeof c.headers === 'object') {
          setHttpHeadersText(Object.entries(c.headers as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join('\n'));
        }
        if (c.bodyMatch != null) setHttpBodyMatch(String(c.bodyMatch));
        if (c.metric != null) setMetric(c.metric as MonitorMetric);
        if (c.comparator != null) setComparator(c.comparator as MonitorComparator);
        if (c.threshold != null) setThreshold(String(c.threshold));
        if (c.windowDays != null) setWindowDays(String(c.windowDays));
        setEvents(r.events);
        setSignalUrl(r.signalUrl);
        setCurrentIncidentId(m.currentIncidentId);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isNew, monitorId]);

  const buildConfig = (): Record<string, unknown> => {
    switch (monitorType) {
      case 'heartbeat':
        return { intervalSeconds: Number(intervalSeconds) || 300 };
      case 'http_check': {
        // "Header: value" lines → object; blank/malformed lines are ignored.
        const headers: Record<string, string> = {};
        for (const line of httpHeadersText.split('\n')) {
          const idx = line.indexOf(':');
          if (idx <= 0) continue;
          const key = line.slice(0, idx).trim();
          const value = line.slice(idx + 1).trim();
          if (key) headers[key] = value;
        }
        return {
          url,
          ...(expectedStatus.trim() ? { expectedStatus: Number(expectedStatus) } : {}),
          ...(httpMethod && httpMethod !== 'GET' ? { method: httpMethod } : {}),
          ...(Object.keys(headers).length ? { headers } : {}),
          ...(httpBodyMatch.trim() ? { bodyMatch: httpBodyMatch.trim() } : {}),
        };
      }
      case 'metric_threshold':
        return { metric, comparator, threshold: Number(threshold) || 0, windowDays: Number(windowDays) || 7 };
      default:
        return {};
    }
  };

  const submit = async () => {
    if (!label.trim()) { setError(t('validationLabel')); return; }
    setSaving(true);
    setError(null);
    const body = {
      label: label.trim(),
      description: description.trim() || null,
      posX,
      posY,
      monitorType,
      config: buildConfig(),
      affectedSystem: affectedSystem.trim() || null,
      severity,
      escalationPolicyId: escalationPolicyId || null,
      active,
    };
    try {
      if (isNew) await monitoringApi.createMonitor(boardId, body);
      else if (monitorId) await monitoringApi.updateMonitor(monitorId, body);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!monitorId) return;
    if (!(await confirm({ message: t('deleteMonitorConfirm', { name: label }), destructive: true }))) return;
    try {
      await monitoringApi.deleteMonitor(monitorId);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const sendSignal = async (status: 'ok' | 'breach') => {
    if (!monitorId) return;
    setError(null);
    try {
      await monitoringApi.testSignal(monitorId, { status });
      if (!isNew && monitorId) {
        const r = await monitoringApi.getMonitor(monitorId);
        setEvents(r.events);
        setCurrentIncidentId(r.monitor.currentIncidentId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signal failed');
    }
  };

  const copySignalUrl = async () => {
    if (!signalUrl) return;
    try {
      await navigator.clipboard.writeText(signalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const showSignalUrl = signalUrl && (monitorType === 'webhook' || monitorType === 'heartbeat');

  return (
    <SlideOutPanel open onClose={onClose} title={isNew ? t('newMonitor') : t('editMonitor')} width="min(560px, 96vw)">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <ErrorCard msg={error} />}
        {loading ? <Loader t={t} /> : (
          <>
            <Field label={t('fieldLabel')}>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('labelPlaceholder')} />
            </Field>
            <Field label={t('fieldDescription')}>
              <textarea className="input" style={{ minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label={t('fieldType')}>
              <Select className="input" value={monitorType} onChange={(e) => setMonitorType(e.target.value as MonitorType)}>
                {MONITOR_TYPES.map((mt) => <option key={mt} value={mt}>{t(`type.${mt}`)}</option>)}
              </Select>
            </Field>

            {monitorType === 'heartbeat' && (
              <Field label={t('fieldIntervalSeconds')}>
                <input className="input" type="number" value={intervalSeconds} onChange={(e) => setIntervalSeconds(e.target.value)} />
              </Field>
            )}
            {monitorType === 'http_check' && (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                  <Field label={t('fieldUrl')}>
                    <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
                  </Field>
                  <Field label={t('fieldMethod')}>
                    <Select className="input" value={httpMethod} onChange={(e) => setHttpMethod(e.target.value)}>
                      {['GET', 'HEAD', 'POST', 'PUT'].map((mm) => <option key={mm} value={mm}>{mm}</option>)}
                    </Select>
                  </Field>
                  <Field label={t('fieldExpectedStatus')}>
                    <input className="input" type="number" value={expectedStatus} onChange={(e) => setExpectedStatus(e.target.value)} />
                  </Field>
                </div>
                <Field label={t('fieldHeaders')}>
                  <textarea className="input" style={{ minHeight: 60 }} value={httpHeadersText}
                    onChange={(e) => setHttpHeadersText(e.target.value)} placeholder={t('headersPlaceholder')} />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t('headersHint')}</div>
                </Field>
                <Field label={t('fieldBodyMatch')}>
                  <input className="input" value={httpBodyMatch} onChange={(e) => setHttpBodyMatch(e.target.value)} placeholder={t('bodyMatchPlaceholder')} />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t('bodyMatchHint')}</div>
                </Field>
              </div>
            )}
            {monitorType === 'metric_threshold' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <Field label={t('fieldMetric')}>
                  <Select className="input" value={metric} onChange={(e) => setMetric(e.target.value as MonitorMetric)}>
                    {METRICS.map((mm) => <option key={mm} value={mm}>{t(`metric.${mm}`)}</option>)}
                  </Select>
                </Field>
                <Field label={t('fieldComparator')}>
                  <Select className="input" value={comparator} onChange={(e) => setComparator(e.target.value as MonitorComparator)}>
                    {COMPARATORS.map((c) => <option key={c} value={c}>{t(`comparator.${c}`)}</option>)}
                  </Select>
                </Field>
                <Field label={t('fieldThreshold')}>
                  <input className="input" type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
                </Field>
                <Field label={t('fieldWindowDays')}>
                  <input className="input" type="number" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
                </Field>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <Field label={t('fieldSystem')}>
                <input className="input" value={affectedSystem} onChange={(e) => setAffectedSystem(e.target.value)} placeholder={t('systemPlaceholder')} />
              </Field>
              <Field label={t('fieldSeverity')}>
                <Select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{t(`severity.${s}`)}</option>)}
                </Select>
              </Field>
              <Field label={t('fieldEscalation')}>
                <Select className="input" value={escalationPolicyId} onChange={(e) => setEscalationPolicyId(e.target.value)}>
                  <option value="">{t('noEscalation')}</option>
                  {policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              <Field label={`${t('position')} X`}>
                <input className="input" type="number" step="0.01" min="0" max="1" value={posX} onChange={(e) => setPosX(Number(e.target.value))} />
              </Field>
              <Field label={`${t('position')} Y`}>
                <input className="input" type="number" step="0.01" min="0" max="1" value={posY} onChange={(e) => setPosY(Number(e.target.value))} />
              </Field>
            </div>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              {t('fieldActive')}
            </label>

            {showSignalUrl && (
              <div style={{ ...card }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('signalUrlLabel')}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <code style={{ fontSize: 12, color: 'var(--text-primary)', wordBreak: 'break-all', flex: 1, minWidth: 0 }}>{signalUrl}</code>
                  <button type="button" className="btn btn-secondary" onClick={copySignalUrl}>{copied ? t('copied') : t('copy')}</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{t('signalUrlHint')}</div>
              </div>
            )}

            {!isNew && (
              <div style={{ ...card }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>{t('testSignal')}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => sendSignal('ok')} disabled={!canManage} style={{ color: 'var(--success-text)' }}>{t('sendOk')}</button>
                  <button type="button" className="btn btn-secondary" onClick={() => sendSignal('breach')} disabled={!canManage} style={{ color: 'var(--error-text)' }}>{t('sendBreach')}</button>
                </div>
              </div>
            )}

            {currentIncidentId && (
              <a href={`/incidents?incident=${currentIncidentId}`} className="btn btn-secondary" style={{ textAlign: 'center' }}>{t('viewIncident')}</a>
            )}

            {!isNew && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('recentEvents')}</div>
                {events.length === 0
                  ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noEvents')}</div>
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {events.map((ev) => (
                        <div key={ev.id} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ color: 'var(--text-muted)' }}>{fmt(ev.createdAt)}</span>
                          <span style={{ fontWeight: 600 }}>{ev.kind}</span>
                          {ev.status && <span>{ev.status}</span>}
                          {ev.message && <span style={{ color: 'var(--text-muted)' }}>{ev.message}</span>}
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={saving || !canManage}>
                {saving ? tc('saving') : (isNew ? t('create') : tc('save'))}
              </button>
              <button type="button" className="btn btn-secondary" onClick={onClose}>{tc('cancel')}</button>
              {!isNew && (
                <button type="button" className="btn btn-secondary" onClick={remove} disabled={!canManage} style={{ marginLeft: 'auto', color: 'var(--error-text)' }}>{tc('delete')}</button>
              )}
            </div>
          </>
        )}
      </div>
    </SlideOutPanel>
  );
}

/* ─────────────────────────── Reporting ─────────────────────────── */

function ReportingSection({ t }: { t: T }) {
  const [report, setReport] = useState<MonitoringReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    monitoringApi.getReport()
      .then(setReport)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader t={t} />;
  if (error) return <ErrorCard msg={error} />;
  if (!report) return <EmptyCard msg={t('noData')} />;

  const { monitors, incidents } = report;

  const sevData: BarDatum[] = SEVERITIES
    .map((s) => ({ key: s, label: t(`severity.${s}`), value: incidents.bySeverity[s] ?? 0 }))
    .filter((d) => d.value > 0);
  const systemData: BarDatum[] = Object.entries(incidents.bySystem)
    .map(([k, v]) => ({ key: k, label: k || t('uncategorized'), value: v }))
    .sort((a, b) => b.value - a.value);
  const sourceData: BarDatum[] = Object.entries(incidents.bySource)
    .map(([k, v]) => ({ key: k, label: k || t('uncategorized'), value: v }))
    .sort((a, b) => b.value - a.value);

  const na = t('na');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        <InsightStat label={t('openIncidents')} value={String(incidents.open)} sub={t('totalIncidents', { count: incidents.total })} />
        <InsightStat label={t('mttr')} value={incidents.mttrMinutes != null ? t('minutesValue', { m: incidents.mttrMinutes }) : na} />
        <InsightStat label={t('monitorsOk')} value={String(monitors.ok)} color="var(--success)" />
        <InsightStat label={t('monitorsBreached')} value={String(monitors.breached)} color="var(--error)" />
        <InsightStat label={t('monitorsUnknown')} value={String(monitors.unknown)} color="var(--muted)" />
        <InsightStat label={t('monitorsTotal')} value={String(monitors.total)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <div style={{ ...card }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>{t('bySeverity')}</div>
          {sevData.length === 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('noIncidents')}</span>
            : <BarChart data={sevData} ariaLabel={t('bySeverity')} />}
        </div>
        <div style={{ ...card }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>{t('bySystem')}</div>
          {systemData.length === 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('noIncidents')}</span>
            : <BarChart data={systemData} ariaLabel={t('bySystem')} maxRows={8} />}
        </div>
        <div style={{ ...card }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>{t('bySource')}</div>
          {sourceData.length === 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('noIncidents')}</span>
            : <BarChart data={sourceData} ariaLabel={t('bySource')} maxRows={8} />}
        </div>
      </div>

      <div style={{ ...card }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>{t('recentIncidents')}</div>
        {incidents.recent.length === 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('noIncidents')}</span>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {incidents.recent.map((inc) => (
                <a key={inc.id} href={`/incidents?incident=${inc.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', textDecoration: 'none' }}>
                  <span className={SEVERITY_BADGE[inc.severity]}>{t(`severity.${inc.severity}`)}</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{inc.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inc.affectedSystem || t('uncategorized')}</span>
                </a>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
