'use client';

/**
 * Reusable DevFinOps lens — R&D Tax Credit, SOC 1 controls, and the audit-ready
 * report — as a chrome-free component (no PageContainer / page header), so it can
 * render BOTH inside the consolidated Finance dashboard's slide-out drill-down
 * panel AND be opened on demand by the Brain. The old standalone /finops page is
 * retired in favour of /insights/finance (this is the body that used to live in
 * FinopsClient).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { usePermission, type Capability } from '@/lib/rbac';
import {
  getRdTaxConfig,
  updateRdTaxConfig,
  getRdTaxReport,
  getSocControls,
  createSocControl,
  updateSocControl,
  getAuditReport,
  downloadAuditReport,
  type RdTaxCreditConfig,
  type RdTaxCreditReport,
  type ControlCoverage,
  type SocControl,
  type SocControlStatus,
  type AuditReport,
} from '@/lib/finopsApi';

// 'finops.manage' is added to the RBAC capability map by the orchestrator-owned
// rbac.ts merge; cast keeps this client typesafe until that lands.
export const FINOPS_CAP = 'finops.manage' as Capability;

export type FinopsTab = 'rd' | 'soc' | 'audit';

const usd = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const hrs = (n: number) => `${Math.round(n).toLocaleString()} h`;
const pct = (n: number) => `${n.toFixed(0)}%`;

const card: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
  borderRadius: 12, padding: 16,
};
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' };
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid var(--border-subtle)' };

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ ...card, minWidth: 150, flex: '1 1 150px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/**
 * The DevFinOps body. `initialTab` lets a drill-down deep-link straight to a
 * section (e.g. the Brain opening the SOC controls). Renders its own tab bar.
 */
export function FinopsLens({ initialTab = 'rd' }: { initialTab?: FinopsTab }) {
  const t = useTranslations('finops');
  const canManage = usePermission(FINOPS_CAP).allowed;
  const [tab, setTab] = useState<FinopsTab>(initialTab);

  const tabBtn = (id: FinopsTab, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      style={{
        padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)',
        background: tab === id ? 'var(--accent, #2563eb)' : 'var(--bg-elevated)',
        color: tab === id ? '#fff' : 'var(--text-primary)', cursor: 'pointer', fontWeight: 600, fontSize: 13,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabBtn('rd', t('tab.rd'))}
        {tabBtn('soc', t('tab.soc'))}
        {tabBtn('audit', t('tab.audit'))}
      </div>

      {tab === 'rd' && <RdSection t={t} canManage={canManage} />}
      {tab === 'soc' && <SocSection t={t} canManage={canManage} />}
      {tab === 'audit' && <AuditSection t={t} />}
    </div>
  );
}

// ── R&D Tax Credit ───────────────────────────────────────────────────────────

function RdSection({ t, canManage }: { t: ReturnType<typeof useTranslations>; canManage: boolean }) {
  const [config, setConfig] = useState<RdTaxCreditConfig | null>(null);
  const [report, setReport] = useState<RdTaxCreditReport | null>(null);
  const [rate, setRate] = useState('');
  const [cats, setCats] = useState('');
  const [actions, setActions] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [cfg, rep] = await Promise.all([getRdTaxConfig(), getRdTaxReport()]);
      setConfig(cfg);
      setReport(rep);
      setRate(String(cfg.blendedLaborRateUsd));
      setCats(cfg.qualifiedCategories.join(', '));
      setActions(cfg.qualifiedActionTypes.join(', '));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const parsed = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
      await updateRdTaxConfig({
        blendedLaborRateUsd: Number(rate) || undefined,
        qualifiedCategories: parsed(cats),
        qualifiedActionTypes: parsed(actions),
      });
      const rep = await getRdTaxReport();
      setReport(rep);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error) return <div style={{ ...card, color: 'var(--danger, #ef4444)' }}>{error}</div>;
  if (!config || !report) return <div style={card}>{t('loading')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card }}>
        <h3 style={{ margin: '0 0 4px' }}>{t('rd.configTitle')}</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>{t('rd.configHint')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ fontSize: 12 }}>
            {t('rd.qualifiedCategories')}
            <input value={cats} onChange={(e) => setCats(e.target.value)} disabled={!canManage}
              placeholder="innovation, tech_debt"
              style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          </label>
          <label style={{ fontSize: 12 }}>
            {t('rd.blendedRate')}
            <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!canManage}
              style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          </label>
          <label style={{ fontSize: 12, gridColumn: '1 / -1' }}>
            {t('rd.qualifiedActionTypes')}
            <input value={actions} onChange={(e) => setActions(e.target.value)} disabled={!canManage}
              placeholder="(optional)"
              style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <RoleGate capability={FINOPS_CAP}>
            <button onClick={() => void save()} disabled={saving}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent, #2563eb)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
              {saving ? t('saving') : t('rd.save')}
            </button>
          </RoleGate>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label={t('rd.qualifiedHours')} value={hrs(report.qualifiedHours)} />
        <StatCard label={t('rd.qualifiedLabor')} value={usd(report.qualifiedLaborUsd)} hint={`@ ${usd(report.blendedRate)}/h`} />
        <StatCard label={t('rd.qualifiedAiSpend')} value={usd(report.qualifiedAiSpendUsd)} />
        <StatCard label={t('rd.qualifiedBase')} value={usd(report.qualifiedBaseUsd)} hint={t('rd.form6765')} />
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 8px' }}>{t('rd.byCategory')}</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>{t('rd.category')}</th>
              <th style={th}>{t('rd.hours')}</th>
              <th style={th}>{t('rd.labor')}</th>
              <th style={th}>{t('rd.aiSpend')}</th>
              <th style={th}>{t('rd.qualified')}</th>
            </tr>
          </thead>
          <tbody>
            {report.byCategory.map((r) => (
              <tr key={r.category} style={{ opacity: r.qualified ? 1 : 0.55 }}>
                <td style={td}>{r.label}</td>
                <td style={td}>{hrs(r.hours)}</td>
                <td style={td}>{usd(r.laborUsd)}</td>
                <td style={td}>{usd(r.aiSpendUsd)}</td>
                <td style={td}>{r.qualified ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── SOC 1 Controls ───────────────────────────────────────────────────────────

const STATUS_OPTIONS: SocControlStatus[] = ['implemented', 'partial', 'gap'];

function SocSection({ t, canManage }: { t: ReturnType<typeof useTranslations>; canManage: boolean }) {
  const [coverage, setCoverage] = useState<ControlCoverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCoverage(await getSocControls());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = async (ctrl: SocControl, change: Partial<{ status: SocControlStatus; owner: string; note: string }>) => {
    if (ctrl.id == null) {
      // Persist the seeded register first (POST seeds defaults), then re-patch.
      setBusy(true);
      try {
        const cov = await createSocControl({ controlRef: ctrl.controlRef, objective: ctrl.objective, category: ctrl.category });
        const persisted = cov.controls.find((c) => c.controlRef === ctrl.controlRef);
        if (persisted?.id != null) {
          setCoverage(await updateSocControl(persisted.id, change));
        } else {
          setCoverage(cov);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      setCoverage(await updateSocControl(ctrl.id, change));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div style={{ ...card, color: 'var(--danger, #ef4444)' }}>{error}</div>;
  if (!coverage) return <div style={card}>{t('loading')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label={t('soc.coverage')} value={pct(coverage.coveragePct)} hint={t('soc.implementedOfTotal', { a: coverage.implemented, b: coverage.total })} />
        <StatCard label={t('soc.implemented')} value={String(coverage.implemented)} />
        <StatCard label={t('soc.partial')} value={String(coverage.partial)} />
        <StatCard label={t('soc.gap')} value={String(coverage.gap)} />
      </div>

      {coverage.seeded && (
        <div style={{ ...card, fontSize: 12, color: 'var(--text-secondary)' }}>{t('soc.seededNote')}</div>
      )}

      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>{t('soc.ref')}</th>
              <th style={th}>{t('soc.objective')}</th>
              <th style={th}>{t('soc.category')}</th>
              <th style={th}>{t('soc.statusCol')}</th>
              <th style={th}>{t('soc.owner')}</th>
            </tr>
          </thead>
          <tbody>
            {coverage.controls.map((ctrl) => (
              <tr key={ctrl.controlRef}>
                <td style={{ ...td, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{ctrl.controlRef}</td>
                <td style={td}>{ctrl.objective}</td>
                <td style={td}>{ctrl.category}</td>
                <td style={td}>
                  <RoleGate capability={FINOPS_CAP}>
                    <select
                      value={ctrl.status}
                      disabled={busy || !canManage}
                      onChange={(e) => void patch(ctrl, { status: e.target.value as SocControlStatus })}
                      style={{ padding: 4, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(`soc.status.${s}`)}</option>)}
                    </select>
                  </RoleGate>
                </td>
                <td style={td}>
                  <RoleGate capability={FINOPS_CAP}>
                    <input
                      defaultValue={ctrl.owner ?? ''}
                      disabled={busy || !canManage}
                      placeholder="—"
                      onBlur={(e) => { if (e.target.value !== (ctrl.owner ?? '')) void patch(ctrl, { owner: e.target.value }); }}
                      style={{ width: 110, padding: 4, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
                    />
                  </RoleGate>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Audit Report ─────────────────────────────────────────────────────────────

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function AuditSection({ t }: { t: ReturnType<typeof useTranslations> }) {
  const [period, setPeriod] = useState(currentMonth());
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      setReport(await getAuditReport(p));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(period); }, [load, period]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12 }}>
          {t('audit.period')}{' '}
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value || currentMonth())}
            style={{ padding: 6, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} />
        </label>
        <div style={{ flex: 1 }} />
        <button onClick={() => void downloadAuditReport('csv', period)}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
          {t('audit.exportCsv')}
        </button>
        <button onClick={() => void downloadAuditReport('json', period)}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
          {t('audit.exportJson')}
        </button>
      </div>

      {error && <div style={{ ...card, color: 'var(--danger, #ef4444)' }}>{error}</div>}
      {loading && <div style={card}>{t('loading')}</div>}

      {report && !loading && (
        <>
          <div style={card}>
            <h3 style={{ margin: '0 0 8px' }}>{t('audit.finance')}</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <StatCard label={t('audit.spend')} value={usd(report.finance.spendUsd)} />
              <StatCard label={t('audit.forecast')} value={usd(report.finance.forecastUsd)} />
              <StatCard label={t('audit.capex')} value={usd(report.allocation.capexUsd)} hint={pct(report.allocation.capitalizablePct)} />
              <StatCard label={t('audit.opex')} value={usd(report.allocation.opexUsd)} />
            </div>
          </div>

          <div style={card}>
            <h3 style={{ margin: '0 0 8px' }}>{t('audit.rd')}</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <StatCard label={t('rd.qualifiedHours')} value={hrs(report.rdTaxCredit.qualifiedHours)} />
              <StatCard label={t('rd.qualifiedBase')} value={usd(report.rdTaxCredit.qualifiedBaseUsd)} />
            </div>
          </div>

          <div style={card}>
            <h3 style={{ margin: '0 0 8px' }}>{t('audit.controls')}</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <StatCard label={t('soc.coverage')} value={pct(report.socControls.coveragePct)} hint={t('soc.implementedOfTotal', { a: report.socControls.implemented, b: report.socControls.total })} />
              <StatCard label={t('audit.evidenceEvents')} value={report.compliance.totalEvents.toLocaleString()} hint={t('audit.sensitive', { n: report.compliance.sensitiveEvents })} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
