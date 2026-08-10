'use client';

import { useEffect, useState } from 'react';
import { salesApi, type SalesCommissionRule, type SalesPricing } from '@/lib/salesApi';

export default function SalesCommissionsPanel() {
  const [rules, setRules] = useState<SalesCommissionRule[]>([]);
  const [pricing, setPricing] = useState<SalesPricing | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { salesApi.commissionRules().then((data) => { setRules(data.rules); setPricing(data.pricing); }).catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load commission rules.')); }, []);
  const percent = (bps: number) => bps / 100;
  const update = (key: string, field: 'referralBps' | 'salesBps', value: string) => setRules((current) => current.map((rule) => rule.ruleKey === key ? { ...rule, [field]: Math.max(0, Math.min(10000, Math.round((Number(value) || 0) * 100))) } : rule));
  const price = (rule: SalesCommissionRule) => {
    if (!pricing) return '—';
    if (rule.plan === 'pro') return rule.billingCycle === 'yearly' ? `$${pricing.pro.yearly}/year` : `$${pricing.pro.monthly}/month`;
    return rule.billingCycle === 'yearly' ? `$${pricing.teams.perSeatYearly}/seat/year` : `$${pricing.teams.perSeatMonthly}/seat/month`;
  };
  async function save() {
    setSaving(true); setMessage(null);
    try {
      const result = await salesApi.saveCommissionRules(rules.map((rule) => ({ plan: rule.plan, billingCycle: rule.billingCycle, referralPercent: percent(rule.referralBps), salesPercent: percent(rule.salesBps) })));
      setRules(result.rules); setMessage('Commission policy saved. Existing earned commissions retain their original snapshot.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save commission rules.'); }
    finally { setSaving(false); }
  }
  return <section>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'start', marginBottom: 20 }}>
      <div><h2 style={{ margin: 0 }}>Referral and sales commissions</h2><p className="text-muted">Set percentages by current Builderforce plan pricing. Rates are snapshotted when a referred customer first converts.</p></div>
      <button className="btn-primary" disabled={saving || !rules.length} onClick={() => void save()}>{saving ? 'Saving…' : 'Save policy'}</button>
    </div>
    {message && <p className="text-muted">{message}</p>}
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Plan</th><th>Price basis</th><th>Referral %</th><th>Sales-assisted %</th></tr></thead><tbody>
      {rules.map((rule) => <tr key={rule.ruleKey}><td><strong>{rule.plan === 'teams' ? 'Teams' : 'Pro'}</strong><div className="text-muted">{rule.billingCycle}</div></td><td>{price(rule)}</td><td><input aria-label={`${rule.ruleKey} referral percent`} type="number" min="0" max="100" step="0.25" value={percent(rule.referralBps)} onChange={(event) => update(rule.ruleKey, 'referralBps', event.target.value)} style={{ width: 100 }} /></td><td><input aria-label={`${rule.ruleKey} sales percent`} type="number" min="0" max="100" step="0.25" value={percent(rule.salesBps)} onChange={(event) => update(rule.ruleKey, 'salesBps', event.target.value)} style={{ width: 100 }} /></td></tr>)}
    </tbody></table></div>
  </section>;
}
