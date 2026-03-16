'use client';

import { useState, useEffect, useCallback } from 'react';
import { auditApi, type AuditEvent } from '@/lib/builderforceApi';

const EVENT_TYPE_COLORS: Record<string, string> = {
  user_registered: 'var(--cyan-bright, #00e5cc)',
  user_login: 'var(--cyan-bright, #00e5cc)',
  task_created: 'var(--text-secondary)',
  task_updated: 'var(--text-secondary)',
  task_submitted: 'var(--coral-bright, #f4726e)',
  execution_completed: 'rgba(34,197,94,0.9)',
  execution_failed: 'var(--coral-bright, #f4726e)',
  claw_registered: 'var(--text-secondary)',
  approval_created: 'rgba(245,158,11,0.9)',
  approval_decided: 'rgba(245,158,11,0.9)',
};

const RESOURCE_TYPE_OPTIONS = [
  '', 'user', 'tenant', 'project', 'task', 'claw', 'execution', 'approval',
];

const EVENT_TYPE_OPTIONS = [
  '',
  'user_registered', 'user_login',
  'task_created', 'task_updated', 'task_submitted',
  'execution_completed', 'execution_failed',
  'claw_registered',
  'approval_created', 'approval_decided',
];

function EventTypeBadge({ type }: { type: string }) {
  const color = EVENT_TYPE_COLORS[type] ?? 'var(--text-muted)';
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 5,
        background: `${color}22`,
        color,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {type.replace(/_/g, ' ')}
    </span>
  );
}

export default function LogsPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    auditApi
      .list({
        limit: 200,
        eventType: eventTypeFilter || undefined,
        resourceType: resourceTypeFilter || undefined,
      })
      .then(setEvents)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [eventTypeFilter, resourceTypeFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>
            Audit Logs
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Immutable event log for all state changes in your workspace.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          style={{
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 600,
            background: 'var(--bg-base)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          ⟳ Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select
          value={eventTypeFilter}
          onChange={(e) => setEventTypeFilter(e.target.value)}
          style={{
            padding: '7px 12px',
            fontSize: 13,
            background: 'var(--bg-base)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
          }}
        >
          <option value="">All event types</option>
          {EVENT_TYPE_OPTIONS.filter(Boolean).map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select
          value={resourceTypeFilter}
          onChange={(e) => setResourceTypeFilter(e.target.value)}
          style={{
            padding: '7px 12px',
            fontSize: 13,
            background: 'var(--bg-base)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
          }}
        >
          <option value="">All resource types</option>
          {RESOURCE_TYPE_OPTIONS.filter(Boolean).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
          {loading ? 'Loading…' : `${events.length} events`}
        </span>
      </div>

      {error && (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            background: 'rgba(244,114,94,0.1)',
            color: 'var(--coral-bright, #f4726e)',
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {!loading && events.length === 0 && (
        <div
          style={{
            padding: 32,
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--text-muted)',
            background: 'var(--bg-base)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
          }}
        >
          No audit events found.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {events.map((ev) => {
          const isExpanded = expandedId === ev.id;
          let meta: Record<string, unknown> | null = null;
          try { meta = ev.metadata ? JSON.parse(ev.metadata) : null; } catch { /* ignore */ }

          return (
            <div
              key={ev.id}
              style={{
                background: 'var(--bg-base)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 10,
                overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <EventTypeBadge type={ev.eventType} />
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ev.resourceType && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      {ev.resourceType}
                      {ev.resourceId ? ` #${ev.resourceId}` : ''} ·{' '}
                    </span>
                  )}
                  {ev.userId ? `user ${ev.userId.slice(0, 8)}…` : 'system'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                  {new Date(ev.createdAt).toLocaleString()}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                  {isExpanded ? '▲' : '▼'}
                </span>
              </button>

              {isExpanded && (
                <div
                  style={{
                    padding: '0 14px 12px',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingTop: 10 }}>
                    {[
                      { label: 'Event ID', value: String(ev.id) },
                      { label: 'Tenant', value: String(ev.tenantId) },
                      { label: 'Resource type', value: ev.resourceType ?? '—' },
                      { label: 'Resource ID', value: ev.resourceId ?? '—' },
                      { label: 'User ID', value: ev.userId ?? 'system' },
                      { label: 'Timestamp', value: new Date(ev.createdAt).toISOString() },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  {meta && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Metadata</div>
                      <pre
                        style={{
                          fontSize: 11,
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-secondary)',
                          background: 'var(--bg-elevated)',
                          padding: '8px 10px',
                          borderRadius: 6,
                          overflowX: 'auto',
                          margin: 0,
                        }}
                      >
                        {JSON.stringify(meta, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
