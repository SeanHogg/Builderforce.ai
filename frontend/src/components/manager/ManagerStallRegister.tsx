'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import Link from 'next/link';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { managerApi, type StallRegister, type StallWatchRow } from '@/lib/builderforceApi';
import { ticketHref } from '@/lib/ticketHref';
import {
  tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle,
} from '@/components/dataTableStyles';
import { useFormat } from "@/i18n/useFormat";

/**
 * The AI Manager's STUCK-TICKET REGISTER.
 *
 * The Activity feed answers "what did the manager do?". This answers the question a
 * human actually opens the Manager page to ask: **what is not moving, and what is
 * being done about it?** Before this existed the honest answer was nowhere on the
 * surface — measured on one tenant, 809 of 821 tickets were stalled and the page
 * showed a healthy stream of decisions the whole time.
 *
 * The load-bearing column is ATTEMPTS. A remedy the manager has applied three times
 * without the ticket moving is not a fix in progress, it is a livelock — so the row
 * flips to "needs you" and sorts to the top. Showing the attempt count is what lets a
 * human tell "the manager is on it" from "the manager has been on it for a week".
 *
 * It also carries the surface's HANDOVER: "Copy diagnostics" serialises the manager's
 * whole state — policy tiers, autonomy health, backlog counts, every management pass and
 * every stuck row — into one paste. This is the tab a human opens when the board has
 * rotted, and a screenshot of it loses exactly the fields that say why (which policy tier
 * turned a capability off, whether the passes are completing, what each remedy has been
 * tried against). See {@link ../../lib/managerDiagnostics}.
 */

const panelStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};
const sectionTitleStyle: CSSProperties = { fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' };
const mutedStyle: CSSProperties = { color: 'var(--text-muted)', fontSize: '0.8rem' };

/** Escalated rows read as "needs a human"; everything else as "manager working". */
function toneFor(row: StallWatchRow): { fg: string; bg: string } {
  return row.escalatedAt
    ? { fg: 'var(--warning-text)', bg: 'var(--warning-bg, rgba(180, 83, 9, 0.12))' }
    : { fg: 'var(--text-muted)', bg: 'var(--bg-base)' };
}

function Badge({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <span
      style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-full)',
        fontSize: '0.72rem', fontWeight: 700, color: fg, background: bg,
        border: '1px solid var(--border-subtle)', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

export interface ManagerStallRegisterProps {
  projectId: number;
}

export function ManagerStallRegister({ projectId }: ManagerStallRegisterProps) {
  const fmt = useFormat();
  const t = useTranslations('manager.stalls');
  const format = useFormatter();
  const [data, setData] = useState<StallRegister | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await managerApi.stalls(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => { void load(); }, [load]);

  const relative = useCallback((iso: string | null): string => {
    if (!iso) return '';
    try {
      return format.relativeTime(new Date(iso), new Date());
    } catch {
      return fmt.dateTime(iso);
    }
  }, [format]);

  /** Idle time as whole days — the unit a human reasons about a stuck ticket in. */
  const idleLabel = useCallback((ms: number): string => {
    const days = Math.floor(ms / 86_400_000);
    return days >= 1 ? t('idleDays', { days }) : t('idleToday');
  }, [t]);

  const causeBars: BarDatum[] = useMemo(
    () => (data?.byCause ?? []).map((c) => ({ key: c.cause, label: t(`cause.${c.cause}`), value: c.count })),
    [data, t],
  );

  // The handover moved OUT of this panel and up beside "Run manager now"
  // ({@link ../manager/ManagerCopyDiagnostics}): most of what the report explains lives on
  // other sub-tabs, and the moment a person wants to capture the state is right after
  // running a pass and seeing nothing change — so it must not be reachable only from here.
  const header = (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...sectionTitleStyle, marginBottom: 4 }}>{t('title')}</div>
      <div style={mutedStyle}>{t('caption', { maxAttempts: data?.maxAttempts ?? 3 })}</div>
    </div>
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {header}
        <div style={{ ...panelStyle, ...mutedStyle }}>{t('loading')}</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {header}
        <div style={{ ...panelStyle, ...mutedStyle }}>
          {error}{' '}
          <button
            type="button"
            onClick={() => void load()}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 700, padding: 0 }}
          >
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }

  const rows = data?.rows ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {header}

      {rows.length === 0 ? (
        <div style={{ ...panelStyle, ...mutedStyle }}>{t('empty')}</div>
      ) : (
        <>
          {/* Headline split: what the manager is handling vs. what it handed back. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div style={{ ...panelStyle, padding: 14 }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {fmt.number((data?.working ?? 0))}
              </div>
              <div style={{ ...mutedStyle, marginTop: 2 }}>{t('stat.working')}</div>
            </div>
            <div style={{ ...panelStyle, padding: 14 }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: (data?.escalated ?? 0) > 0 ? 'var(--warning-text)' : 'var(--text-primary)' }}>
                {fmt.number((data?.escalated ?? 0))}
              </div>
              <div style={{ ...mutedStyle, marginTop: 2 }}>{t('stat.escalated')}</div>
            </div>
          </div>

          {causeBars.length > 0 && (
            <div style={panelStyle}>
              <div style={{ ...sectionTitleStyle, marginBottom: 10 }}>{t('byCause')}</div>
              <BarChart data={causeBars} ariaLabel={t('byCause')} labelWidth={150} />
            </div>
          )}

          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('col.ticket')}</th>
                  <th style={{ ...thStyle, width: 190 }}>{t('col.cause')}</th>
                  <th style={thStyle}>{t('col.doing')}</th>
                  <th style={{ ...thStyle, width: 110 }}>{t('col.attempts')}</th>
                  <th style={{ ...thStyle, width: 120 }}>{t('col.stuckFor')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const tone = toneFor(row);
                  return (
                    <tr key={row.taskId} style={trStyle}>
                      <td style={tdStyle}>
                        <Link
                          href={ticketHref(row.taskId)}
                          style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
                        >
                          {row.title}
                        </Link>
                        <div style={{ ...mutedStyle, marginTop: 2 }}>{row.status}</div>
                      </td>
                      <td style={tdStyle}>
                        <Badge label={t(`cause.${row.cause}`)} fg={tone.fg} bg={tone.bg} />
                      </td>
                      <td style={tdMutedStyle}>
                        {row.detail}
                        {row.lastAttemptAt && (
                          <div style={{ ...mutedStyle, marginTop: 2 }}>
                            {t('lastTried', { when: relative(row.lastAttemptAt) })}
                          </div>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {row.escalatedAt ? (
                          <Badge
                            label={t('needsYou')}
                            fg="var(--warning-text)"
                            bg="var(--warning-bg, rgba(180, 83, 9, 0.12))"
                          />
                        ) : (
                          <span style={mutedStyle}>
                            {t('attemptsOf', { attempts: row.attempts, max: data?.maxAttempts ?? 3 })}
                          </span>
                        )}
                      </td>
                      <td style={tdMutedStyle}>{idleLabel(row.idleMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default ManagerStallRegister;
