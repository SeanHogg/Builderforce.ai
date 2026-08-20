'use client';

/**
 * Workforce health — over-allocated, under-utilised and idle, in ONE card.
 *
 * The three cohorts were each derivable and none of them was readable together.
 * `emp.over-allocated` drew a utilisation bar chart, which answers "who is
 * drowning" and cannot answer "who has room" (a short bar is a member with slack
 * OR a member with a generous ceiling, and the chart cannot tell you which). Idle
 * members were in no chart at all, because the allocation read is derived from
 * members holding open work — being idle is precisely what removes you from it.
 *
 * The failure that produces is asymmetric, which is why it survived: an overloaded
 * person is visible from across the room and an under-loaded one is not. So this
 * shows the three counts side by side, and names the people underneath, which is
 * the only form in which the question "who?" is actually answered.
 *
 * It reads the composed server cohorts (`/api/dashboards/workforce-health`)
 * through {@link useSharedSource}, so a dashboard holding this card and the Ask
 * box's copy of it makes one request, not two.
 */

import { useTranslations } from 'next-intl';
import { WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { dashboardsApi, type WorkforceHealthMember, type WorkforceHealthResult } from '@/lib/dashboardsApi';

/** Where the manager goes to actually rebalance — the same drill the EMP cards use. */
const DRILL: WidgetDrill = { kind: 'route', href: '/workforce?tab=performance' };

/**
 * Cohort tone. Over-allocated and idle are both costs — one burns a person out,
 * the other wastes them — so both read as warnings; slack is an OPPORTUNITY, not a
 * fault, and is deliberately neutral. All three are theme tokens: a bare hex here
 * would be legible in exactly one theme.
 */
const TONE = {
  over: 'var(--danger)',
  under: 'var(--text-secondary)',
  idle: 'var(--warning)',
} as const;

type CohortKey = 'over' | 'under' | 'idle';

function Cohort({ label, members, tone }: { label: string; members: WorkforceHealthMember[]; tone: string }) {
  const t = useTranslations('widgets');
  return (
    <div style={{
      flex: '1 1 160px', minWidth: 0, padding: 12, borderRadius: 'var(--radius-md)',
      background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: members.length ? tone : 'var(--text-muted)', lineHeight: 1.1 }}>
        {members.length}
      </div>
      {members.length === 0 ? (
        <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('workforceHealth.none')}</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {members.slice(0, 4).map((m) => (
            <li
              key={`${m.memberKind}:${m.memberRef}`}
              title={t('workforceHealth.memberDetail', { wip: m.observedWip, max: m.maxWip })}
              style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {m.name} <span style={{ color: 'var(--text-muted)' }}>· {t('workforceHealth.wipShort', { wip: m.observedWip })}</span>
            </li>
          ))}
          {members.length > 4 && (
            <li style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
              {t('workforceHealth.more', { count: members.length - 4 })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function WorkforceHealthCard({ days }: WidgetCardProps) {
  const t = useTranslations('widgets');
  // Keyed on the window so a dashboard that changes its period re-reads rather
  // than showing last period's cohorts under this period's heading.
  const { data, error } = useSharedSource<WorkforceHealthResult>(
    `dashboards:workforce-health:${days}`,
    () => dashboardsApi.workforceHealth(days),
  );

  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('emp.loading')}</Muted>;
  if (data.totalMembers === 0) return <Muted>{t('emp.noData')}</Muted>;

  const cohorts: { key: CohortKey; label: string; members: WorkforceHealthMember[] }[] = [
    { key: 'over', label: t('workforceHealth.overAllocated'), members: data.overAllocated },
    { key: 'under', label: t('workforceHealth.underUtilised'), members: data.underUtilised },
    { key: 'idle', label: t('workforceHealth.idle'), members: data.idle },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Wraps rather than scrolls: at 360px the three cohorts stack, which is the
          only layout in which each still shows its names. */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {cohorts.map((c) => <Cohort key={c.key} label={c.label} members={c.members} tone={TONE[c.key]} />)}
      </div>
      <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        {t('workforceHealth.summary', { total: data.totalMembers, withWork: data.membersWithWork, days: data.days })}
      </div>
    </div>
  );
}

export const WORKFORCE_HEALTH_WIDGETS: WidgetDef[] = [
  {
    id: 'workforce.health',
    group: 'empAllocation',
    titleKey: 'workforceHealth',
    descKey: 'workforceHealth',
    capability: 'insights.engineering',
    size: 'lg',
    Card: WorkforceHealthCard,
    drill: DRILL,
  },
];
