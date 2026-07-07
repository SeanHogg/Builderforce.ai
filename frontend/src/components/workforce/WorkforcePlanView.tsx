'use client';

/**
 * WorkforcePlanView — the blended human + agent workforce-planning surface.
 *
 * Reads /api/workforce/plan (computeWorkforcePlan) and renders: headline KPIs
 * (members, in-flight WIP, allocatable gap, weekly cost, agent WIP share), the
 * hire-vs-agent weekly-cost split (donut), and per-member capacity-vs-WIP bars
 * split human / agent (BarChart with the WIP ceiling as the faint comparison
 * track). Manager surface (the API gates it); mount behind a <RoleGate>.
 *
 * Uses the shared chart primitives + InsightStat, theme tokens, responsive,
 * localized (`workforcePlan`).
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { colorAt } from '@/components/charts/chartColors';
import { workforcePlanApi, type WorkforcePlan, type WorkforcePlanMember } from '@/lib/personaCadenceApi';

const int = (n: number) => Math.round(n).toLocaleString();
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

const HUMAN_COLOR = colorAt(1);
const AGENT_COLOR = colorAt(3);

const grid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14,
};
const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20,
};

/** One member → a capacity-vs-WIP bar: value = open WIP, faint track = WIP ceiling. */
function memberBars(members: WorkforcePlanMember[], color: string): BarDatum[] {
  return members
    .slice(0, 12)
    .map((m) => ({
      key: `${m.memberKind}:${m.memberRef}`,
      label: m.memberName,
      value: m.openWip,
      secondary: m.maxConcurrentWip ?? undefined,
      color: m.overAllocated ? 'var(--coral-bright, #f4726e)' : color,
    }));
}

export function WorkforcePlanView() {
  const t = useTranslations('workforcePlan');
  const [plan, setPlan] = useState<WorkforcePlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    workforcePlanApi.get()
      .then((p) => { if (alive) setPlan(p); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  if (error) return <div style={{ fontSize: 13, color: 'var(--coral-bright, #f4726e)' }}>{error}</div>;
  if (!plan) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>;

  const { totals, members } = plan;
  const humans = members.filter((m) => m.population === 'human');
  const agents = members.filter((m) => m.population === 'agent');

  const costSegments = [
    { key: 'human', label: t('human'), value: totals.humanWeeklyCostUsd, color: HUMAN_COLOR },
    { key: 'agent', label: t('agent'), value: totals.agentWeeklyCostUsd, color: AGENT_COLOR },
  ].filter((s) => s.value > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Headline KPIs ── */}
      <div style={grid}>
        <InsightStat label={t('members')} value={int(totals.memberCount)} sub={t('membersSub', { human: humans.length, agent: agents.length })} />
        <InsightStat label={t('inFlight')} value={int(totals.totalOpenWip)} sub={t('inFlightSub')} color={colorAt(0)} />
        <InsightStat label={t('capacityGap')} value={int(totals.capacityGapWip)} sub={t('capacityGapSub')} color={colorAt(2)} />
        <InsightStat label={t('weeklyCost')} value={usd(totals.totalWeeklyCostUsd)} sub={t('weeklyCostSub')} color={colorAt(5)} />
        <InsightStat label={t('agentShare')} value={pct(totals.agentWipShare)} sub={t('agentShareSub')} color={AGENT_COLOR} />
      </div>

      {/* ── Hire-vs-agent weekly cost split ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, alignItems: 'stretch' }}>
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t('hireVsAgent')}</div>
          {costSegments.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noCost')}</div>
          ) : (
            <DonutChart
              segments={costSegments}
              centerValue={usd(totals.totalWeeklyCostUsd)}
              centerLabel={t('perWeek')}
              formatValue={(v) => usd(v)}
              ariaLabel={t('hireVsAgent')}
            />
          )}
        </div>

        {/* ── Capacity vs WIP: humans ── */}
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t('humanCapacity')}</div>
          {humans.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noHumans')}</div>
          ) : (
            <BarChart data={memberBars(humans, HUMAN_COLOR)} formatValue={int} ariaLabel={t('humanCapacity')} />
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>{t('barLegend')}</div>
        </div>

        {/* ── Capacity vs WIP: agents ── */}
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t('agentCapacity')}</div>
          {agents.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noAgents')}</div>
          ) : (
            <BarChart data={memberBars(agents, AGENT_COLOR)} formatValue={int} ariaLabel={t('agentCapacity')} />
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>{t('barLegend')}</div>
        </div>
      </div>
    </div>
  );
}
