'use client';

/**
 * Owner panel: per-seat AI spend limits (Teams). The account owner sets a team-wide
 * DEFAULT monthly cap and can override it per seat, and sees each seat's
 * month-to-date spend (metered at the OpenRouter rate for non-BYO usage). Budget /
 * spend notifications ride the same caps and surface in the notification bell.
 *
 * Owner-gated via <RoleGate capability="billing.spendLimits"> (block variant) so a
 * non-owner sees it disabled with the role hint rather than hidden. Server is the
 * real authority (requireRole OWNER on the writes).
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { usePermission } from '@/lib/rbac';
import { getStoredTenant } from '@/lib/auth';
import {
  getSpendLimits,
  setDefaultSpendLimit,
  setSeatSpendLimit,
  seatCapMode,
  millicentsToUsd,
  type TeamSpendOverview,
  type SeatSpend,
  type SeatCapMode,
} from '@/lib/spendLimits';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 20,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6,
};
const helpText: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px',
};
const inputStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 13, borderRadius: 8, width: 110,
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
};
// Native <option> needs its own opaque bg/fg — theme tokens don't reach the OS popup.
const optionStyle: React.CSSProperties = { background: 'var(--bg-elevated)', color: 'var(--text-primary)' };
const primaryBtn: React.CSSProperties = {
  padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
  background: 'var(--accent, #2563eb)', color: '#fff', border: 'none',
};

function fmtUsd(mc: number): string {
  return `$${millicentsToUsd(mc).toFixed(2)}`;
}

/** A colour for the spend bar that escalates with utilisation (theme tokens). */
function barColor(pct: number): string {
  if (pct >= 100) return 'var(--coral-bright, #ef4444)';
  if (pct >= 80) return 'var(--amber-bright, #f59e0b)';
  return 'var(--accent, #2563eb)';
}

function SeatRow({
  seat, disabled, onSave,
}: {
  seat: SeatSpend;
  disabled: boolean;
  onSave: (userId: string, mode: SeatCapMode, amountUsd?: number) => Promise<void>;
}) {
  const t = useTranslations('settings');
  const [mode, setMode] = useState<SeatCapMode>(seatCapMode(seat.capMillicents));
  const [amount, setAmount] = useState<string>(
    seat.capMillicents != null && seat.capMillicents >= 0 ? String(millicentsToUsd(seat.capMillicents)) : '',
  );
  const [saving, setSaving] = useState(false);

  // Re-sync when the seat prop changes (after a save refetch).
  useEffect(() => {
    setMode(seatCapMode(seat.capMillicents));
    setAmount(seat.capMillicents != null && seat.capMillicents >= 0 ? String(millicentsToUsd(seat.capMillicents)) : '');
  }, [seat.capMillicents]);

  const effUnlimited = seat.effectiveCapMillicents == null;
  const pct = seat.percentUsed;

  const save = async () => {
    setSaving(true);
    try {
      await onSave(seat.userId, mode, mode === 'custom' ? Number(amount || 0) : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
        padding: '12px 0', borderTop: '1px solid var(--border-subtle)',
      }}
    >
      {/* Identity */}
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {seat.name || seat.email || seat.userId}
        </div>
        {seat.email && seat.name && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seat.email}</div>
        )}
      </div>

      {/* Spend bar */}
      <div style={{ flex: '2 1 200px', minWidth: 160 }}>
        <div style={{ height: 8, borderRadius: 5, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
          <div style={{ width: `${effUnlimited ? 0 : pct}%`, height: '100%', background: barColor(pct), transition: 'width .2s' }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          {effUnlimited
            ? t('spendUnlimitedUsage', { spent: fmtUsd(seat.spentMillicents) })
            : t('spendOfCap', { spent: fmtUsd(seat.spentMillicents), cap: fmtUsd(seat.effectiveCapMillicents ?? 0) })}
        </div>
      </div>

      {/* Cap control */}
      <div style={{ flex: '1 1 260px', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
        <select
          value={mode}
          disabled={disabled || saving}
          onChange={(e) => setMode(e.target.value as SeatCapMode)}
          aria-label={t('spendModeLabel')}
          style={{ ...inputStyle, width: 'auto', cursor: disabled ? 'default' : 'pointer' }}
        >
          <option value="inherit" style={optionStyle}>{t('spendModeInherit')}</option>
          <option value="unlimited" style={optionStyle}>{t('spendModeUnlimited')}</option>
          <option value="custom" style={optionStyle}>{t('spendModeCustom')}</option>
        </select>
        {mode === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>$</span>
            <input
              type="number" min={0} step={1} inputMode="decimal"
              value={amount}
              disabled={disabled || saving}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('spendAmountPlaceholder')}
              aria-label={t('spendAmountLabel')}
              style={{ ...inputStyle, width: 90 }}
            />
          </div>
        )}
        <button type="button" onClick={() => void save()} disabled={disabled || saving} style={{ ...primaryBtn, opacity: disabled || saving ? 0.6 : 1 }}>
          {saving ? t('spendSaving') : t('spendSave')}
        </button>
      </div>
    </div>
  );
}

function TeamSpendInner() {
  const t = useTranslations('settings');
  const tenant = getStoredTenant();
  const { allowed } = usePermission('billing.spendLimits');

  const [overview, setOverview] = useState<TeamSpendOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultDraft, setDefaultDraft] = useState('');
  const [savingDefault, setSavingDefault] = useState(false);
  const [notice, setNotice] = useState('');

  const applyOverview = useCallback((o: TeamSpendOverview) => {
    setOverview(o);
    setDefaultDraft(o.defaultCapMillicents != null ? String(millicentsToUsd(o.defaultCapMillicents)) : '');
  }, []);

  useEffect(() => {
    if (!tenant) { setLoading(false); return; }
    getSpendLimits(tenant.id)
      .then(applyOverview)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenant, applyOverview]);

  const saveDefault = async () => {
    if (!tenant) return;
    setSavingDefault(true);
    setNotice('');
    try {
      const amountUsd = defaultDraft.trim() === '' ? null : Number(defaultDraft);
      const o = await setDefaultSpendLimit(tenant.id, amountUsd);
      applyOverview(o);
      setNotice(t('spendSaved'));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t('spendSaveFailed'));
    } finally {
      setSavingDefault(false);
    }
  };

  const saveSeat = async (userId: string, mode: SeatCapMode, amountUsd?: number) => {
    if (!tenant) return;
    setNotice('');
    try {
      const o = await setSeatSpendLimit(tenant.id, userId, mode, amountUsd);
      applyOverview(o);
      setNotice(t('spendSaved'));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t('spendSaveFailed'));
    }
  };

  if (!tenant) return null;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <div style={sectionTitle}>{t('spendTitle')}</div>
        <p style={helpText}>{t('spendDescription')}</p>
      </div>

      {loading ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : error ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--coral-bright, #ef4444)' }}>{t('error', { message: error })}</div>
      ) : overview && !overview.seatControlsEnabled ? (
        <div style={{ ...cardStyle }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 6 }}>{t('spendTeamsOnlyTitle')}</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('spendTeamsOnly')}</p>
        </div>
      ) : overview ? (
        <>
          {/* Team-wide default */}
          <div style={cardStyle}>
            <div style={sectionTitle}>{t('spendDefaultTitle')}</div>
            <p style={helpText}>{t('spendDefaultDescription')}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>$</span>
              <input
                type="number" min={0} step={1} inputMode="decimal"
                value={defaultDraft}
                disabled={!allowed || savingDefault}
                onChange={(e) => setDefaultDraft(e.target.value)}
                placeholder={t('spendNoDefaultPlaceholder')}
                aria-label={t('spendDefaultLabel')}
                style={inputStyle}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('spendPerSeatMonth')}</span>
              <button type="button" onClick={() => void saveDefault()} disabled={!allowed || savingDefault} style={{ ...primaryBtn, opacity: !allowed || savingDefault ? 0.6 : 1 }}>
                {savingDefault ? t('spendSaving') : t('spendSave')}
              </button>
              {notice && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{notice}</span>}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 0' }}>{t('spendDefaultHint')}</p>
          </div>

          {/* Per-seat overrides + spend */}
          <div style={cardStyle}>
            <div style={sectionTitle}>{t('spendSeatsTitle')}</div>
            <p style={helpText}>
              {t('spendResetsOn', { date: new Date(overview.periodResetsAt).toLocaleDateString() })}
            </p>
            {overview.seats.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('spendNoSeats')}</div>
            ) : (
              <div>
                {overview.seats.map((seat) => (
                  <SeatRow
                    key={seat.userId}
                    seat={seat}
                    disabled={!allowed}
                    onSave={saveSeat}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Owner-gated wrapper: dims the whole panel for non-owners with the role hint. */
export default function TeamSpendLimits() {
  return (
    <RoleGate capability="billing.spendLimits" variant="block">
      <TeamSpendInner />
    </RoleGate>
  );
}
