'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { PresenceAgent, WorkforcePresence } from '@/lib/useWorkforcePresence';

/**
 * "Who's online" — a live at-a-glance strip of the workforce present right now:
 * humans online (in the IDE or on the web) and agents (idle or actively working
 * a task). Presentation-only: it takes an already-fetched presence roster (from
 * useWorkforcePresence) so a parent that already holds one reuses that single
 * poll instead of starting a second. Renders a compact empty state rather than
 * hiding, since on the dashboard "no one online" is itself useful information.
 */

function elapsedLabel(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

function AgentRow({ a, tAgent }: { a: PresenceAgent; tAgent: (key: string, values?: Record<string, string | number>) => string }) {
  const el = elapsedLabel(a.elapsedMs);
  return (
    <div style={rowStyle}>
      <span
        style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: a.working ? 'rgba(245,158,11,0.95)' : 'rgba(34,197,94,0.9)',
        }}
      />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
          {a.working ? (a.taskTitle ? tAgent('workingOn', { task: a.taskTitle }) : tAgent('working')) : tAgent('online')}
        </span>
      </span>
      {a.working && el && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{el}</span>
      )}
    </div>
  );
}

/** Presentational strip — render from an already-fetched presence roster so the
 *  parent that already holds one (the dashboard metric tile) reuses that single
 *  hook instance instead of spinning up a second poll. */
export function WorkforcePresenceStripView({ presence }: { presence: WorkforcePresence }) {
  const t = useTranslations('dashboard');
  const tAgent = (key: string, values?: Record<string, string | number>) => t(`presence.agent.${key}`, values);
  const { people, agents, workingCount, onlineCount, loading } = presence;

  return (
    <section
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        background: 'var(--bg-elevated)',
        padding: 16,
        marginBottom: 24,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {t('presence.title')}
        </h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {loading ? t('presence.loading') : t('presence.summary', { online: onlineCount, working: workingCount })}
        </span>
      </div>

      {!loading && onlineCount === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{t('presence.empty')}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {/* People */}
          <div>
            <div style={groupLabelStyle}>{t('presence.peopleHeading', { count: people.length })}</div>
            {people.length === 0 ? (
              <p style={emptyGroupStyle}>{t('presence.noPeople')}</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {people.map((p) => (
                  <div key={p.userId ?? p.name} style={rowStyle}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(34,197,94,0.9)', flexShrink: 0 }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {p.inIde ? t('presence.inIde') : t('presence.activeSession')}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Agents */}
          <div>
            <div style={groupLabelStyle}>{t('presence.agentsHeading', { count: agents.length })}</div>
            {agents.length === 0 ? (
              <p style={emptyGroupStyle}>{t('presence.noAgents')}</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {agents.map((a) => <AgentRow key={a.key} a={a} tAgent={tAgent} />)}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, textAlign: 'right' }}>
        <Link href="/workforce" style={{ fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)', textDecoration: 'none' }}>
          {t('presence.manage')} →
        </Link>
      </div>
    </section>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const groupLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', marginBottom: 8,
};
const emptyGroupStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--text-muted)' };
