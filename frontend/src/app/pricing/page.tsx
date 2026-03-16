'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { AUTH_API_URL, getStoredTenantToken } from '@/lib/auth';

interface Subscription {
  plan: 'free' | 'pro';
  effectivePlan: 'free' | 'pro';
  billingStatus: string;
  billingCycle: 'monthly' | 'annual' | null;
  billingEmail: string | null;
  billingPaymentBrand: string | null;
  billingPaymentLast4: string | null;
  billingUpdatedAt: string | null;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 24,
};

const PLAN_FEATURES: Record<string, { free: string; pro: string }[]> = {
  features: [
    { free: '1 claw', pro: 'Unlimited claws' },
    { free: '5 projects', pro: 'Unlimited projects' },
    { free: 'Community support', pro: 'Priority support' },
    { free: '10K tokens / day', pro: '1M tokens / day' },
    { free: 'Basic observability', pro: 'Full audit trail + insights' },
    { free: '—', pro: 'Fleet mesh + remote dispatch' },
    { free: '—', pro: 'Advanced skills & channels' },
    { free: '—', pro: 'Custom agent roles' },
  ],
};

function PlanBadge({ plan }: { plan: 'free' | 'pro' }) {
  const isPro = plan === 'pro';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 700,
        textTransform: 'uppercase',
        background: isPro ? 'var(--surface-coral-soft, rgba(244,114,94,0.15))' : 'var(--bg-elevated)',
        color: isPro ? 'var(--coral-bright, #f4726e)' : 'var(--text-muted)',
      }}
    >
      {plan}
    </span>
  );
}

export default function PricingPage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id != null ? Number(tenant.id) : null;

  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Upgrade form state
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [billingEmail, setBillingEmail] = useState('');
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

  useEffect(() => { fetchSub(); }, [tenantId]);

  const handleUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || upgrading) return;
    if (!billingEmail.trim() || !cardLast4.trim()) {
      setUpgradeError('All fields are required.');
      return;
    }
    if (!/^\d{4}$/.test(cardLast4)) {
      setUpgradeError('Card last 4 must be exactly 4 digits.');
      return;
    }
    setUpgrading(true);
    setUpgradeError(null);
    try {
      const token = getStoredTenantToken();
      const res = await fetch(`${AUTH_API_URL}/api/tenants/${tenantId}/subscription/pro`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          billingCycle,
          billingEmail: billingEmail.trim(),
          billingPaymentBrand: cardBrand,
          billingPaymentLast4: cardLast4.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `${res.status}`);
      }
      setShowUpgrade(false);
      await fetchSub();
    } catch (e) {
      setUpgradeError(e instanceof Error ? e.message : 'Upgrade failed');
    } finally {
      setUpgrading(false);
    }
  };

  const handleDowngrade = async () => {
    if (!tenantId || downgrading) return;
    if (!confirm('Downgrade to Free? You will lose Pro features at end of billing period.')) return;
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

  const isPro = sub?.plan === 'pro';

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Pricing & Billing</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
          Manage your subscription and billing details.
        </p>
      </div>

      {error && (
        <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {/* Current plan */}
      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading subscription…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Current Plan</div>
                <PlanBadge plan={sub?.plan ?? 'free'} />
                {sub?.billingStatus && sub.billingStatus !== 'active' && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({sub.billingStatus})</span>
                )}
              </div>
              {isPro && sub && (
                <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  {sub.billingCycle && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 120 }}>Billing cycle</span>
                      <span style={{ textTransform: 'capitalize' }}>{sub.billingCycle}</span>
                    </div>
                  )}
                  {sub.billingEmail && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 120 }}>Billing email</span>
                      <span>{sub.billingEmail}</span>
                    </div>
                  )}
                  {sub.billingPaymentBrand && sub.billingPaymentLast4 && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 120 }}>Payment method</span>
                      <span style={{ textTransform: 'capitalize' }}>{sub.billingPaymentBrand} ···· {sub.billingPaymentLast4}</span>
                    </div>
                  )}
                  {sub.billingUpdatedAt && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 120 }}>Last updated</span>
                      <span>{new Date(sub.billingUpdatedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!isPro ? (
                <button
                  type="button"
                  onClick={() => setShowUpgrade(true)}
                  style={{
                    padding: '9px 18px',
                    fontSize: 13,
                    fontWeight: 600,
                    background: 'var(--coral-bright, #f4726e)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  Upgrade to Pro
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDowngrade}
                  disabled={downgrading}
                  style={{
                    padding: '9px 18px',
                    fontSize: 13,
                    fontWeight: 600,
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    cursor: downgrading ? 'wait' : 'pointer',
                  }}
                >
                  {downgrading ? 'Downgrading…' : 'Downgrade to Free'}
                </button>
              )}
            </div>
          </div>

          {/* Upgrade form */}
          {showUpgrade && !isPro && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Upgrade to Pro</div>
              <form onSubmit={handleUpgrade} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Billing Cycle
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['monthly', 'annual'] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setBillingCycle(c)}
                        style={{
                          padding: '7px 16px',
                          fontSize: 13,
                          fontWeight: 600,
                          borderRadius: 8,
                          border: '1px solid var(--border-subtle)',
                          background: billingCycle === c ? 'var(--surface-coral-soft, rgba(244,114,94,0.15))' : 'var(--bg-elevated)',
                          color: billingCycle === c ? 'var(--coral-bright, #f4726e)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          textTransform: 'capitalize',
                        }}
                      >
                        {c}{c === 'annual' ? ' (save 20%)' : ''}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Billing Email
                  </label>
                  <input
                    type="email"
                    required
                    value={billingEmail}
                    onChange={(e) => setBillingEmail(e.target.value)}
                    placeholder="billing@example.com"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: 13,
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      Card Brand
                    </label>
                    <select
                      value={cardBrand}
                      onChange={(e) => setCardBrand(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: 13,
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                      }}
                    >
                      {['visa', 'mastercard', 'amex', 'discover', 'other'].map((b) => (
                        <option key={b} value={b} style={{ textTransform: 'capitalize' }}>{b.charAt(0).toUpperCase() + b.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      Card Last 4 Digits
                    </label>
                    <input
                      type="text"
                      required
                      value={cardLast4}
                      onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="4242"
                      maxLength={4}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: 13,
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        boxSizing: 'border-box',
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                  </div>
                </div>

                {upgradeError && (
                  <div style={{ fontSize: 12, color: 'var(--coral-bright, #f4726e)' }}>{upgradeError}</div>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => { setShowUpgrade(false); setUpgradeError(null); }}
                    style={{
                      padding: '8px 16px',
                      fontSize: 13,
                      background: 'none',
                      color: 'var(--text-muted)',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={upgrading}
                    style={{
                      padding: '8px 18px',
                      fontSize: 13,
                      fontWeight: 600,
                      background: 'var(--coral-bright, #f4726e)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      cursor: upgrading ? 'wait' : 'pointer',
                    }}
                  >
                    {upgrading ? 'Activating…' : 'Activate Pro'}
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
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)' }}>
                      Feature
                    </th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                      Free
                    </th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700, color: 'var(--coral-bright, #f4726e)', borderBottom: '1px solid var(--border-subtle)' }}>
                      Pro
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PLAN_FEATURES.features.map(({ free, pro }, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '9px 12px', color: 'var(--text-secondary)' }}>
                        {pro !== '—' ? pro : free}
                      </td>
                      <td style={{ textAlign: 'center', padding: '9px 12px', color: free === '—' ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                        {free === '—' ? '✕' : '✓'}
                      </td>
                      <td style={{ textAlign: 'center', padding: '9px 12px', color: pro === '—' ? 'var(--text-muted)' : 'var(--coral-bright, #f4726e)' }}>
                        {pro === '—' ? '✕' : '✓'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
