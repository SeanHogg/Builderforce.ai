'use client';

/**
 * "Publish a listing" under Talent → Gigs — a BOARD PICKER, not a form.
 *
 * ── WHY A PICKER ─────────────────────────────────────────────────────────────
 * The storefront's publish CTA used to open the skill form for every chip it had
 * no route for, so Talent offered slug/version/repo fields that describe neither
 * a freelancer nor a gig. The person half was a route lookup (`/freelancer/profile`
 * — the `available_for_hire` opt-in). The gig half was not: `POST
 * /api/marketplace/publish` publishes a gig FROM AN EXISTING TICKET and derives
 * the title, the description and the requirements from it, so there is no "post a
 * gig" page to point at and never was.
 *
 * The honest CTA is therefore this: choose the work. A form that re-collected a
 * title and a description would be asking somebody to retype what a ticket
 * already says, and the two copies would immediately disagree.
 *
 * ── WHAT PUBLISHING ACTUALLY DOES ────────────────────────────────────────────
 * Marks the ticket `hireable` and mints (or reopens) its one job posting. A
 * ticket owns ONE posting identity for its whole life — re-publishing a closed
 * one reopens that row rather than minting a replacement, so proposals and
 * history are never orphaned. The page says so before the click, because "publish"
 * on a ticket somebody published last quarter is not obviously the same act.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { tasksApi, gigMarketplaceApi, type Task } from '@/lib/builderforceApi';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { RoleGate } from '@/components/RoleGate';
import PageContainer from '@/components/PageContainer';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
  minWidth: 0,
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 380,
  boxSizing: 'border-box',
  padding: '8px 10px',
  fontSize: 'var(--font-size-body)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
};

const primaryButton: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 'var(--font-size-body)',
  fontWeight: 600,
  borderRadius: 'var(--radius-md)',
  background: 'var(--accent-strong, var(--surface-interactive))',
  color: 'var(--text-on-accent, var(--text-primary))',
  border: '1px solid var(--border-subtle)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/** Work that is finished, cancelled or already someone's problem is not work to
 *  hire for. A closed lane on a board is not a gig. */
const CLOSED_LANES = new Set(['done', 'closed', 'cancelled', 'archived']);

export default function PublishGigClient() {
  const t = useTranslations('publishGig');
  const scope = useOptionalProjectScope();

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(scope?.currentProjectId ?? null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<number | null>(null);
  const [published, setPublished] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects()
      .then((list) => {
        setProjects(list);
        setProjectId((current) => current ?? (list[0] ? Number(list[0].id) : null));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const loadTasks = useCallback(async () => {
    if (projectId == null) { setTasks([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      setTasks(await tasksApi.list(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  /** Open work only, and never a GAP or a SECURITY ticket — one is a defect
   *  found in our own delivery and the other is redacted from the person looking
   *  at it, so neither is something to offer a stranger. */
  const publishable = useMemo(
    () => tasks.filter((task) => (
      !CLOSED_LANES.has(task.status.toLowerCase())
      && task.taskType !== 'gap'
      && task.taskType !== 'security'
      && !task.restricted
    )),
    [tasks],
  );

  const publish = async (task: Task) => {
    setPublishing(task.id);
    setError(null);
    try {
      const result = await gigMarketplaceApi.publish({ ticketId: task.id });
      setPublished((prev) => ({ ...prev, [task.id]: result.jobId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(null);
    }
  };

  return (
    <PageContainer width="readable" style={{ padding: 'clamp(20px, 5vw, 32px)' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: 0, maxWidth: '65ch' }}>{t('subtitle')}</p>
      </div>

      {error && (
        <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 'var(--font-size-body)', marginBottom: 14 }}>{error}</div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
          {t('projectLabel')}
        </label>
        <select
          style={selectStyle}
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
        >
          {projects.map((project) => (
            // A native <option> needs its OWN opaque background and colour — one
            // that inherits only the wrapper's is unreadable in one of the themes.
            <option key={project.id} value={project.id} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : publishable.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
          <p style={{ margin: '0 0 10px' }}>{t('empty')}</p>
          <Link href="/tasks" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t('openBoard')}</Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {publishable.map((task) => (
            <div key={task.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 600, color: 'var(--text-primary)' }}>{task.title}</div>
                <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 2 }}>
                  {task.key} · {task.status}
                </div>
              </div>
              {published[task.id] ? (
                <Link
                  href={`/marketplace?family=talent&kind=gig`}
                  style={{ fontSize: 'var(--font-size-body)', fontWeight: 600, color: 'var(--text-primary)' }}
                >
                  {t('viewListing')}
                </Link>
              ) : (
                <RoleGate capability="members.invite">
                  <button
                    type="button"
                    style={primaryButton}
                    disabled={publishing === task.id}
                    onClick={() => void publish(task)}
                  >
                    {publishing === task.id ? t('publishing') : t('publish')}
                  </button>
                </RoleGate>
              )}
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 18, maxWidth: '65ch' }}>{t('reopenNote')}</p>
    </PageContainer>
  );
}
