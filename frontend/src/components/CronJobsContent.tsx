'use client';

import { useState, useEffect, useCallback } from 'react';
import { cronApi, type CronJob } from '@/lib/builderforceApi';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

export interface CronJobsContentProps {
  clawId: number;
  /** When set, only show cron jobs for this project. */
  projectId?: number;
  /** Hide the project column (e.g. when embedded inside a project panel). */
  hideProjectColumn?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function CronJobsContent({
  clawId,
  projectId,
  hideProjectColumn,
  className,
  style,
}: CronJobsContentProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState('');
  const [formSchedule, setFormSchedule] = useState('0 9 * * 1-5');
  const [formProjectId, setFormProjectId] = useState<string>(projectId != null ? String(projectId) : '');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await cronApi.list(clawId, projectId);
      setJobs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cron jobs');
    } finally {
      setLoading(false);
    }
  }, [clawId, projectId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formSchedule.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await cronApi.create(clawId, {
        name: formName.trim(),
        schedule: formSchedule.trim(),
        projectId: formProjectId ? Number(formProjectId) : (projectId ?? null),
      });
      setJobs((prev) => [created, ...prev]);
      setFormName('');
      setFormSchedule('0 9 * * 1-5');
      setFormProjectId(projectId != null ? String(projectId) : '');
      setShowCreate(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create cron job');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (job: CronJob) => {
    try {
      const updated = await cronApi.update(clawId, job.id, { enabled: !job.enabled });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    }
  };

  const handleDelete = async (jobId: string) => {
    try {
      await cronApi.delete(clawId, jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    border: '1px solid var(--border-subtle)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text-primary)',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: 4,
  };

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 14, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{jobs.length} cron job{jobs.length !== 1 ? 's' : ''}</div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--coral-bright)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          {showCreate ? 'Cancel' : '+ New Cron Job'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', fontSize: 13, background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: 8 }}>
          {error}
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Daily sync" style={inputStyle} autoFocus />
          </div>
          <div>
            <label style={labelStyle}>Schedule (cron expression)</label>
            <input type="text" value={formSchedule} onChange={(e) => setFormSchedule(e.target.value)} placeholder="0 9 * * 1-5" style={inputStyle} />
          </div>
          {!hideProjectColumn && projectId == null && (
            <div>
              <label style={labelStyle}>Project ID (optional)</label>
              <input type="text" value={formProjectId} onChange={(e) => setFormProjectId(e.target.value)} placeholder="e.g. 1" style={inputStyle} />
            </div>
          )}
          <div>
            <button
              type="submit"
              disabled={saving || !formName.trim()}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                background: 'var(--coral-bright)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: saving ? 'wait' : 'pointer',
              }}
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 16 }}>Loading cron jobs…</div>
      ) : jobs.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>
          No cron jobs configured. Create one to schedule automated tasks.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {jobs.map((job) => (
            <div key={job.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{job.name}</div>
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>{job.schedule}</div>
                {!hideProjectColumn && job.projectId != null && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Project #{job.projectId}</div>
                )}
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: job.enabled ? 'rgba(34,197,94,0.15)' : 'var(--bg-elevated)',
                  color: job.enabled ? '#22c55e' : 'var(--text-muted)',
                }}
              >
                {job.enabled ? 'Enabled' : 'Disabled'}
              </span>
              {job.lastStatus && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{job.lastStatus}</span>
              )}
              {job.lastRunAt && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last: {new Date(job.lastRunAt).toLocaleString()}</span>
              )}
              <button
                type="button"
                onClick={() => toggleEnabled(job)}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--surface-interactive)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                {job.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(job.id)}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'rgba(239,68,68,0.1)',
                  color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
