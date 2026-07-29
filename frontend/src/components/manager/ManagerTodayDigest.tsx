'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import Link from 'next/link';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { buildPeriodDelta } from '@/components/dashboard/metricFormat';
import { managerApi, type ManagerDailyDigest, type DigestContributor } from '@/lib/builderforceApi';
import { isManagerActionType } from '@/lib/managerActions';
import { ticketHref } from '@/lib/ticketHref';

/**
 * TODAY — the answer to "what did you and the team accomplish today?"
 *
 * ── WHY THIS LEADS THE MANAGER TAB ───────────────────────────────────────────────
 * The surface used to open on backlog STATE: 679 tickets, 373 coverage gaps, 390 open
 * PRs. Those are standing properties of the board. They barely move day to day, none
 * of them is an accomplishment, and a person who came to find out what got done left
 * without an answer. Backlog health is a real question — it is just the SECOND one,
 * and it now sits below this panel rather than in front of it.
 *
 * ── ANSWER FIRST, EVIDENCE AFTER ─────────────────────────────────────────────────
 * The headline is a sentence, not a grid: the reader should be able to stop after one
 * line. Everything under it is the evidence for that sentence — the counts it was
 * derived from, the tickets that actually closed, the decisions the manager took, who
 * did the work, and what autonomy handed back. The order is deliberate and matches the
 * lifecycle-diagnostics convention: verdict, then the rows that justify it.
 *
 * ── A ZERO MUST SAY WHICH KIND OF ZERO IT IS ─────────────────────────────────────
 * "Nothing shipped" is ambiguous between a quiet morning and a stopped board, so every
 * headline number carries its own vs-yesterday chip and the quiet-day state states
 * yesterday's totals outright. The `manager.decisions` count is checked separately from
 * the team's: a day where the manager groomed the backlog and the team shipped nothing
 * is NOT a day where nothing happened, and reporting it as one would be a lie about
 * work that is journalled on the Activity tab.
 *
 * Fully localized, themed for light + dark via CSS variables, and responsive.
 */

const panelStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};
const sectionTitleStyle: CSSProperties = { fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' };
const mutedStyle: CSSProperties = { color: 'var(--text-muted)', fontSize: '0.8rem' };
const subTitleStyle: CSSProperties = { fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' };

/** How often the digest re-reads. Matches the overview's own background refresh. */
const REFRESH_MS = 60_000;

/** The icon for a contributor's kind — humans and agents are one team, one list. */
const KIND_ICON: Record<DigestContributor['kind'], string> = {
  human: '🧑',
  hire: '🤝',
  cloud_agent: '🤖',
  host_agent: '🖥️',
  system: '⚙️',
};

export interface ManagerTodayDigestProps {
  projectId: number;
}

export function ManagerTodayDigest({ projectId }: ManagerTodayDigestProps) {
  const t = useTranslations('manager.today');
  // Decision labels are REUSED from the activity feed's catalog rather than duplicated —
  // one translation per manager decision class for the whole surface.
  const tAction = useTranslations('manager.action');
  const format = useFormatter();

  const [data, setData] = useState<ManagerDailyDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await managerApi.digest(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => { void load(); }, [load]);

  // The day keeps moving while the tab is open — a digest that froze at page load would
  // stop being today's answer within minutes of a run finishing.
  useEffect(() => {
    const id = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const relative = useCallback((iso: string | null): string => {
    if (!iso) return '';
    try {
      return format.relativeTime(new Date(iso), new Date());
    } catch {
      return new Date(iso).toLocaleString();
    }
  }, [format]);

  const decisionBars: BarDatum[] = useMemo(
    () => (data?.manager.byType ?? []).map((d) => ({
      key: d.actionType,
      // An action type this build predates renders as its raw name rather than a
      // missing-key path — the count is still true even when the label is not known.
      label: isManagerActionType(d.actionType) ? tAction(d.actionType) : d.actionType,
      value: d.count,
    })),
    [data, tAction],
  );

  const header = (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden>📣</span>
        <span style={sectionTitleStyle}>{t('title')}</span>
      </div>
      {data && (
        <span style={mutedStyle}>
          {format.dateTime(new Date(data.dayStart), { weekday: 'long', month: 'short', day: 'numeric' })}
          {' · '}
          {t('updated', { when: relative(data.computedAt) })}
        </span>
      )}
    </div>
  );

  if (loading && !data) {
    return <section style={panelStyle}>{header}<div style={{ ...mutedStyle, marginTop: 12 }}>{t('loading')}</div></section>;
  }

  if (error && !data) {
    return (
      <section style={panelStyle}>
        {header}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--danger-text, #b91c1c)', fontSize: '0.85rem' }}>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            style={{
              padding: '4px 10px', borderRadius: 8, fontSize: '0.8rem', cursor: 'pointer',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)',
            }}
          >
            {t('retry')}
          </button>
        </div>
      </section>
    );
  }

  if (!data) return null;

  const { manager, team, shipped, needsAttention } = data;
  // The SAME predicate the API exposes (`isQuietDay`), applied to the payload it sent —
  // the manager's own decisions count, so a grooming-only day is not "nothing happened".
  const quiet = team.shipped.today === 0
    && team.laneMoves.forward === 0
    && team.runs.completed === 0
    && team.runs.failed === 0
    && team.prs.merged.today === 0
    && manager.decisions.today === 0;

  return (
    <section style={panelStyle}>
      {header}

      {/* ── The answer, in a sentence ── */}
      {quiet ? (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('headline.quiet')}
          </p>
          <p style={{ ...mutedStyle, margin: '6px 0 0' }}>
            {t('headline.quietYesterday', {
              shipped: team.shipped.yesterday,
              merged: team.prs.merged.yesterday,
              decisions: manager.decisions.yesterday,
            })}
          </p>
        </div>
      ) : (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.45 }}>
            {t('headline.team', {
              shipped: team.shipped.today,
              merged: team.prs.merged.today,
              runs: team.runs.completed,
            })}
          </p>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary, var(--text-primary))', lineHeight: 1.45 }}>
            {t('headline.manager', { passes: manager.passes, decisions: manager.decisions.today })}
          </p>
        </div>
      )}

      {/* ── The counts the sentence came from ── */}
      <div style={{
        marginTop: 14, display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
      }}>
        <InsightStat
          label={t('stat.shipped')}
          value={team.shipped.today.toLocaleString()}
          sub={t('stat.shippedSub', { opened: team.opened.today })}
          delta={buildPeriodDelta(team.shipped.today, team.shipped.yesterday, true)}
        />
        <InsightStat
          label={t('stat.merged')}
          value={team.prs.merged.today.toLocaleString()}
          sub={t('stat.mergedSub', { opened: team.prs.opened })}
          delta={buildPeriodDelta(team.prs.merged.today, team.prs.merged.yesterday, true)}
        />
        <InsightStat
          label={t('stat.runs')}
          value={team.runs.completed.toLocaleString()}
          sub={t('stat.runsSub', { failed: team.runs.failed })}
        />
        <InsightStat
          label={t('stat.moves')}
          value={team.laneMoves.forward.toLocaleString()}
          // An UNATTRIBUTED hop gets its own clause instead of being folded into
          // "by agents" — claiming agent credit for a move no agent can be named for is
          // what let the contributor table show every agent at zero while this line said
          // work was being done by them. Only shown when there is any, so the common
          // fully-attributed day reads exactly as before.
          sub={team.laneMoves.bySystem > 0
            ? t('stat.movesSubWithSystem', {
              human: team.laneMoves.byHuman,
              agent: team.laneMoves.byAgent,
              system: team.laneMoves.bySystem,
            })
            : t('stat.movesSub', { human: team.laneMoves.byHuman, agent: team.laneMoves.byAgent })}
        />
        <InsightStat
          label={t('stat.decisions')}
          value={manager.decisions.today.toLocaleString()}
          sub={t('stat.decisionsSub', { passes: manager.passes })}
          delta={buildPeriodDelta(manager.decisions.today, manager.decisions.yesterday, null)}
        />
      </div>

      {/* ── The evidence: what closed, and what the manager decided ── */}
      <div style={{
        marginTop: 16, display: 'grid', gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      }}>
        <div>
          <div style={subTitleStyle}>{t('shipped.title')}</div>
          {shipped.length === 0 ? (
            <p style={{ ...mutedStyle, marginTop: 8, marginBottom: 0 }}>{t('shipped.empty')}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {shipped.map((s) => (
                <li key={s.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <Link
                    href={ticketHref(s.id)}
                    style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 700,
                      color: 'var(--accent, #2563eb)', textDecoration: 'none', flexShrink: 0,
                    }}
                  >
                    {s.key}
                  </Link>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', minWidth: 0, flex: '1 1 140px' }}>
                    {s.title}
                  </span>
                  <span style={{ ...mutedStyle, fontSize: '0.75rem', flexShrink: 0 }}>
                    {s.ownerName || t('shipped.unowned')}
                  </span>
                </li>
              ))}
              {team.shipped.today > shipped.length && (
                <li style={{ ...mutedStyle, fontSize: '0.75rem' }}>
                  {t('shipped.more', { n: team.shipped.today - shipped.length })}
                </li>
              )}
            </ul>
          )}
        </div>

        <div>
          <div style={subTitleStyle}>{t('decisions.title')}</div>
          {decisionBars.length === 0 ? (
            <p style={{ ...mutedStyle, marginTop: 8, marginBottom: 0 }}>{t('decisions.empty')}</p>
          ) : (
            /* Wide content scrolls inside its own box; the page body never scrolls sideways. */
            <div style={{ marginTop: 10, overflowX: 'auto' }}>
              <BarChart data={decisionBars} maxRows={6} labelWidth={120} ariaLabel={t('decisions.aria')} />
            </div>
          )}
        </div>
      </div>

      {/* ── Who did it. Humans and agents in ONE list, because that is one team. ── */}
      {team.contributors.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={subTitleStyle}>{t('contributors.title')}</div>
          <div style={{ ...mutedStyle, marginTop: 2 }}>{t('contributors.caption')}</div>
          <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {team.contributors.map((c) => (
              <li
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
                  borderRadius: 8, padding: '7px 10px',
                }}
              >
                <span aria-hidden style={{ flexShrink: 0 }}>{KIND_ICON[c.kind] ?? '•'}</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', flex: '1 1 120px', minWidth: 0 }}>
                  {c.name}
                </span>
                {/* The three metrics are shown SIDE BY SIDE and never summed: a finished
                    ticket, a completed run and a lane hop are different units, and a total
                    would be a score the data does not support. */}
                <span style={{ ...mutedStyle, fontSize: '0.75rem' }}>
                  {t('contributors.metrics', { shipped: c.shipped, runs: c.runs, moves: c.moves })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── What autonomy could not finish. The honest tail of the answer. ── */}
      {needsAttention.openEscalations > 0 && (
        <div
          style={{
            marginTop: 16, padding: 12, borderRadius: 10,
            border: '1px solid var(--warning-border, var(--border-subtle))',
            borderLeft: '3px solid var(--warning-text, #b45309)',
            background: 'var(--bg-base)',
          }}
        >
          <div style={{ ...subTitleStyle, color: 'var(--warning-text, #b45309)' }}>
            {t('attention.title', { open: needsAttention.openEscalations, today: needsAttention.escalatedToday })}
          </div>
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {needsAttention.items.map((item) => (
              <li key={item.taskId} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <Link
                  href={ticketHref(item.taskId)}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 700,
                    color: 'var(--accent, #2563eb)', textDecoration: 'none', flexShrink: 0,
                  }}
                >
                  {item.key ?? `#${item.taskId}`}
                </Link>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)', flex: '1 1 140px', minWidth: 0 }}>
                  {item.title}
                </span>
                <span style={{ ...mutedStyle, fontSize: '0.73rem', flexShrink: 0 }}>
                  {t('attention.since', { when: relative(item.since) })}
                </span>
              </li>
            ))}
          </ul>
          {/* The register is where these get worked — this panel names them, it does not
              replace the surface built to diagnose them. */}
          <Link
            href="/projects?tab=manager&sub=stuck"
            style={{ display: 'inline-block', marginTop: 8, fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent, #2563eb)' }}
          >
            {t('attention.open')}
          </Link>
        </div>
      )}

      {/* The decision feed is one click away and is the drill-in for everything above. */}
      <div style={{ marginTop: 14, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Link href="/projects?tab=manager&sub=activity" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent, #2563eb)' }}>
          {t('viewActivity')}
        </Link>
        {manager.lastRunAt && (
          <span style={mutedStyle}>{t('lastPass', { when: relative(manager.lastRunAt) })}</span>
        )}
      </div>
    </section>
  );
}
