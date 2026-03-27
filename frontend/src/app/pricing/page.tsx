'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { AUTH_API_URL, getStoredTenantToken } from '@/lib/auth';

type Plan = 'free' | 'pro' | 'teams';

interface Subscription {
  plan: Plan;
  effectivePlan: Plan;
  billingStatus: string;
  billingCycle: 'monthly' | 'yearly' | null;
  billingEmail: string | null;
  billingPaymentBrand: string | null;
  billingPaymentLast4: string | null;
  billingUpdatedAt: string | null;
  seatCount: number | null;
  paymentProvider: string;
  pricing: {
    pro: { monthly: number; yearly: number; yearlySavingsPercent: number };
    teams: { perSeatMonthly: number; perSeatYearly: number; yearlySavingsPercent: number; minimumSeats: number };
    managedClaw: { perClawMonthly: number };
  };
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 24,
};

const PLAN_FEATURES: { label: string; free: boolean; pro: boolean; teams: boolean }[] = [
  { label: '1 Claw',                           free: true,  pro: false, teams: false },
  { label: 'Up to 3 Claws',                    free: false, pro: true,  teams: false },
  { label: 'Unlimited Claws',                  free: false, pro: false, teams: true  },
  { label: '5 projects',                       free: true,  pro: false, teams: false },
  { label: 'Unlimited projects',               free: false, pro: true,  teams: true  },
  { label: '10K tokens / day',                 free: true,  pro: false, teams: false },
  { label: '1M tokens / day',                  free: false, pro: true,  teams: false },
  { label: '5M tokens / day',                  free: false, pro: false, teams: true  },
  { label: 'Approval workflows',               free: false, pro: true,  teams: true  },
  { label: 'Fleet mesh + remote dispatch',     free: false, pro: true,  teams: true  },
  { label: 'Full telemetry + audit trail',     free: false, pro: true,  teams: true  },
  { label: 'Custom agent roles',               free: false, pro: true,  teams: true  },
  { label: 'Shared team approval inbox',       free: false, pro: false, teams: true  },
  { label: 'Per-seat cost controls',           free: false, pro: false, teams: true  },
  { label: 'Priority support',                 free: false, pro: true,  teams: true  },
  { label: 'Community support',                free: true,  pro: false, teams: false },
];

function PlanBadge({ plan }: { plan: Plan }) {
  const colors: Record<Plan, { bg: string; color: string; label: string }> = {
    free:  { bg: 'var(--bg-elevated)', color: 'var(--text-muted)', label: 'Free' },
    pro:   { bg: 'var(--surface-coral-soft, rgba(244,114,94,0.15))', color: 'var(--coral-bright, #f4726e)', label: 'Pro' },
    teams: { bg: 'rgba(96,165,250,0.15)', color: '#60a5fa', label: 'Teams' },
  };
  const { bg, color, label } = colors[plan];
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', background: bg, color }}>
      {label}
    </span>
  );
}

function CheckIcon({ checked, color }: { checked: boolean; color: string }) {
  return (
    <span style={{ color: checked ? color : 'var(--text-muted)', fontWeight: 700, fontSize: 14 }}>
      {checked ? '✓' : '—'}
    </span>
  );
}

export default function PricingPage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id != null ? Number(tenant.id) : null;

  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [upgradeTarget, setUpgradeTarget] = useState<'pro' | 'teams' | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [billingEmail, setBillingEmail] = useState('');
  const [seats, setSeats] = useState(3);
  const [cardBrand, setCardBrand] = useState('visa');
  const [cardLast4, setCardLast4] = useState('');
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [downgrading, setDowngrading] = useState(false);

  const fetchSub = async () => {
    if (tenantId == null) return;
    setLoading(true);
    setError(null);
    try {
      const token = getStoredTenantToken();
      const res = await fetch(`${AUTH_API_URL}/api/tenants/${tenantId}/subscription`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as Subscription;
      setSub(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subscription');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchSub(); }, [tenantId]);

  const isManualProvider = !sub || sub.paymentProvider === 'manual';
  const effectivePlan = sub?.effectivePlan ?? 'free';

  const proMonthly  = sub?.pricing.pro.monthly ?? 29;
  const proYearly   = sub?.pricing.pro.yearly ?? 290;
  const teamMonthly = sub?.pricing.teams.perSeatMonthly ?? 20;
  const teamYearly  = sub?.pricing.teams.perSeatYearly ?? 192;

  const upgradePrice = upgradeTarget === 'teams'
    ? (billingCycle === 'yearly' ? teamYearly * seats : teamMonthly * seats)
    : (billingCycle === 'yearly' ? proYearly : proMonthly);

  const handleUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || upgrading || !upgradeTarget) return;
    if (!billingEmail.trim()) { setUpgradeError('Billing email is required.'); return; }
    if (isManualProvider && (!cardLast4.trim() || !/^\d{4}$/.test(cardLast4))) {
      setUpgradeError('Card last 4 must be exactly 4 digits.'); return;
    }
    setUpgrading(true);
    setUpgradeError(null);
    try {
      const token = getStoredTenantToken();
      const res = await fetch(`${AUTH_API_URL}/api/tenants/${tenantId}/subscription/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          targetPlan: upgradeTarget,
          billingCycle,
          billingEmail: billingEmail.trim(),
          ...(upgradeTarget === 'teams' && { seats }),
          ...(isManualProvider && { billingPaymentBrand: cardBrand, billingPaymentLast4: cardLast4.trim() }),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `${res.status}`);
      }
      const result = await res.json() as { checkoutUrl: string | null };
      if (result.checkoutUrl) { window.location.href = result.checkoutUrl; return; }
      setUpgradeTarget(null);
      await fetchSub();
    } catch (e) {
      setUpgradeError(e instanceof Error ? e.message : 'Upgrade failed');
    } finally {
      setUpgrading(false);
    }
  };

  const handleDowngrade = async () => {
    if (!tenantId || downgrading) return;
    if (!confirm('Downgrade to Free? You will lose your current plan features at end of billing period.')) return;
    setDowngrading(true);
    try {
      const token = getStoredTenantToken();
      const res = await fetch(`${AUTH_API_URL}/api/tenants/${tenantId}/subscription/free`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`${res.status}`);
      await fetchSub();
    } catch { /* noop */ }
    finally { setDowngrading(false); }
  };

  const teamsCostNote = upgradeTarget === 'teams'
    ? billingCycle === 'yearly'
      ? `$${teamYearly}/seat/yr — billed as $${teamYearly * seats}/yr`
      : `$${teamMonthly}/seat/mo — billed as $${teamMonthly * seats}/mo`
    : null;

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Pricing & Billing</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
          Manage your subscription and billing details.
        </p>
      </div>

      {error && <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading subscription…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Current plan */}
          <div style={{ ...cardStyle, display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Current Plan</div>
                <PlanBadge plan={sub?.plan ?? 'free'} />
                {sub?.billingStatus && sub.billingStatus !== 'active' && sub.billingStatus !== 'none' && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({sub.billingStatus})</span>
                )}
              </div>
              {effectivePlan !== 'free' && sub && (
                <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  {sub.billingCycle && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 130 }}>Billing cycle</span>
                      <span style={{ textTransform: 'capitalize' }}>{sub.billingCycle}</span>
                    </div>
                  )}
                  {sub.seatCount != null && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 130 }}>Seats</span>
                      <span>{sub.seatCount}</span>
                    </div>
                  )}
                  {sub.billingEmail && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 130 }}>Billing email</span>
                      <span>{sub.billingEmail}</span>
                    </div>
                  )}
                  {sub.billingPaymentBrand && sub.billingPaymentLast4 && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 130 }}>Payment method</span>
                      <span style={{ textTransform: 'capitalize' }}>{sub.billingPaymentBrand} ···· {sub.billingPaymentLast4}</span>
                    </div>
                  )}
                  {sub.billingUpdatedAt && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 130 }}>Last updated</span>
                      <span>{new Date(sub.billingUpdatedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            {effectivePlan !== 'free' && (
              <button type="button" onClick={handleDowngrade} disabled={downgrading}
                style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: downgrading ? 'wait' : 'pointer' }}>
                {downgrading ? 'Downgrading…' : 'Downgrade to Free'}
              </button>
            )}
          </div>

          {/* Upgrade form */}
          {upgradeTarget && effectivePlan !== upgradeTarget && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>
                Upgrade to {upgradeTarget === 'teams' ? 'Teams' : 'Pro'}
              </div>
              <form onSubmit={handleUpgrade} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Billing Cycle</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['monthly', 'yearly'] as const).map((c) => {
                      const saving = upgradeTarget === 'teams'
                        ? `save ${sub?.pricing.teams.yearlySavingsPercent ?? 20}%`
                        : `save ${sub?.pricing.pro.yearlySavingsPercent ?? 17}%`;
                      return (
                        <button key={c} type="button" onClick={() => setBillingCycle(c)}
                          style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid var(--border-subtle)', background: billingCycle === c ? 'var(--surface-coral-soft, rgba(244,114,94,0.15))' : 'var(--bg-elevated)', color: billingCycle === c ? 'var(--coral-bright, #f4726e)' : 'var(--text-secondary)', cursor: 'pointer' }}>
                          {c}{c === 'yearly' ? ` (${saving})` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {upgradeTarget === 'teams' && (
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Seats</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="number" min={1} value={seats}
                        onChange={(e) => setSeats(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        style={{ width: 80, padding: '8px 12px', fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8 }} />
                      {teamsCostNote && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{teamsCostNote}</span>}
                    </div>
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Billing Email</label>
                  <input type="email" required value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)}
                    placeholder="billing@example.com"
                    style={{ width: '100%', padding: '8px 12px', fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8, boxSizing: 'border-box' }} />
                </div>

                {isManualProvider && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Card Brand</label>
                      <select value={cardBrand} onChange={(e) => setCardBrand(e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                        {['visa', 'mastercard', 'amex', 'discover', 'other'].map((b) => (
                          <option key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Card Last 4 Digits</label>
                      <input type="text" required value={cardLast4}
                        onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="4242" maxLength={4}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8, boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} />
                    </div>
                  </div>
                )}

                {!isManualProvider && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                    You will be redirected to our payment provider to securely enter your card details.
                  </div>
                )}

                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                  Total: ${upgradePrice}/{billingCycle === 'yearly' ? 'yr' : 'mo'}
                  {upgradeTarget === 'teams' && ` for ${seats} seat${seats > 1 ? 's' : ''}`}
                </div>

                {upgradeError && <div style={{ fontSize: 12, color: 'var(--coral-bright, #f4726e)' }}>{upgradeError}</div>}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => { setUpgradeTarget(null); setUpgradeError(null); }}
                    style={{ padding: '8px 16px', fontSize: 13, background: 'none', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={upgrading}
                    style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, background: upgradeTarget === 'teams' ? '#60a5fa' : 'var(--coral-bright, #f4726e)', color: '#fff', border: 'none', borderRadius: 8, cursor: upgrading ? 'wait' : 'pointer' }}>
                    {upgrading
                      ? (isManualProvider ? 'Activating…' : 'Redirecting…')
                      : (isManualProvider ? `Activate ${upgradeTarget === 'teams' ? 'Teams' : 'Pro'}` : 'Continue to Payment')}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Plan comparison table */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Plan Comparison</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)' }}>Feature</th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)', minWidth: 90 }}>
                      Free<br /><span style={{ fontWeight: 400, fontSize: 11 }}>$0</span>
                    </th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700, color: 'var(--coral-bright, #f4726e)', borderBottom: '1px solid var(--border-subtle)', minWidth: 90 }}>
                      Pro<br /><span style={{ fontWeight: 400, fontSize: 11 }}>${proMonthly}/mo</span>
                    </th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700, color: '#60a5fa', borderBottom: '1px solid var(--border-subtle)', minWidth: 110 }}>
                      Teams<br /><span style={{ fontWeight: 400, fontSize: 11 }}>${teamMonthly}/seat/mo</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PLAN_FEATURES.map(({ label, free, pro, teams }, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '9px 12px', color: 'var(--text-secondary)' }}>{label}</td>
                      <td style={{ textAlign: 'center', padding: '9px 12px' }}><CheckIcon checked={free} color="var(--text-secondary)" /></td>
                      <td style={{ textAlign: 'center', padding: '9px 12px' }}><CheckIcon checked={pro} color="var(--coral-bright, #f4726e)" /></td>
                      <td style={{ textAlign: 'center', padding: '9px 12px' }}><CheckIcon checked={teams} color="#60a5fa" /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ padding: '14px 12px' }} />
                    <td style={{ textAlign: 'center', padding: '14px 12px' }}>
                      {effectivePlan === 'free'
                        ? <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Current plan</span>
                        : null}
                    </td>
                    <td style={{ textAlign: 'center', padding: '14px 12px' }}>
                      {effectivePlan === 'pro' ? (
                        <span style={{ fontSize: 12, color: 'var(--coral-bright)', fontWeight: 600 }}>Current plan</span>
                      ) : (
                        <button type="button" onClick={() => { setUpgradeTarget('pro'); setUpgradeError(null); }}
                          style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, background: 'var(--coral-bright, #f4726e)', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer' }}>
                          Upgrade to Pro
                        </button>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', padding: '14px 12px' }}>
                      {effectivePlan === 'teams' ? (
                        <span style={{ fontSize: 12, color: '#60a5fa', fontWeight: 600 }}>Current plan</span>
                      ) : (
                        <button type="button" onClick={() => { setUpgradeTarget('teams'); setUpgradeError(null); }}
                          style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, background: '#60a5fa', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer' }}>
                          Upgrade to Teams
                        </button>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted)' }}>
              Add-on: <strong>Managed Claw</strong> — ${sub?.pricing.managedClaw.perClawMonthly ?? 49}/mo per hosted Claw. We run your CoderClaw instance for you — no Docker, no DevOps.
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
