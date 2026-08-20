'use client';

/**
 * SuspectAccountsPanel — the review the signup OTP gate could not do backwards.
 *
 * Migration 0285 introduced the gate and backfilled `email_verified_at =
 * created_at` for every account that already existed. That was the right call —
 * nobody could be locked out retroactively — but it also handed every fake
 * account created BEFORE the gate a permanent verified badge. The gate only
 * stopped new ones.
 *
 * The backfill left a signature (verified in the same second the account was
 * created, which a real verification never is), and this lists accounts that
 * carry it AND look unused: never signed in, or on a throwaway mail domain.
 *
 * The action is deliberately mild — REVOKE the stamp, do not delete the account.
 * A revoked person gets the ordinary "verify your email" path on next sign-in,
 * so a real account caught by the heuristic repairs itself and no operator has
 * to be right the first time.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminSuspectAccount } from '@/lib/adminApi';
import { AdminError, AdminLoading, AdminPanelHeader, useAdminData, useAdminFormat } from '@/components/admin/adminShared';
import { useConfirm } from '@/components/ConfirmProvider';

export default function SuspectAccountsPanel() {
  const t = useTranslations('admin.suspectAccounts');
  const { fmtDateTime } = useAdminFormat();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useAdminData<{ accounts: AdminSuspectAccount[] }>(
    () => adminApi.suspectAccounts(),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const accounts = data?.accounts ?? [];
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const revoke = async () => {
    if (selected.size === 0) return;
    // Destructive to the person's access, so it goes through the approval modal
    // rather than a toast-and-undo.
    const ok = await confirm({
      title: t('confirmTitle'),
      message: t('confirmMessage', { count: selected.size }),
      confirmLabel: t('revoke'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setFailure(null);
    try {
      await adminApi.revokeSuspectAccounts([...selected]);
      setSelected(new Set());
      reload();
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <AdminLoading />;

  return (
    <div>
      <AdminPanelHeader title={t('title')} subtitle={t('subtitle')} onRefresh={reload} />
      <AdminError message={error ?? failure} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', margin: '0 0 12px', flexWrap: 'wrap' }}>
        <span className="text-muted" style={{ fontSize: 'var(--font-size-small)' }}>
          {t('found', { count: accounts.length })}
        </span>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy || selected.size === 0}
          aria-busy={busy}
          onClick={revoke}
        >
          {busy ? t('revoking') : t('revokeSelected', { count: selected.size })}
        </button>
      </div>

      {accounts.length === 0 ? (
        <p className="text-muted" style={{ padding: 12 }}>{t('empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}><span className="sr-only">{t('select')}</span></th>
                <th>{t('account')}</th>
                <th>{t('created')}</th>
                <th>{t('signals')}</th>
                <th style={{ textAlign: 'right' }}>{t('workspaces')}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(account.id)}
                      onChange={() => toggle(account.id)}
                      aria-label={t('selectOne', { email: account.email })}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{account.email}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>{account.username}</div>
                  </td>
                  <td className="text-muted">{fmtDateTime(account.createdAt)}</td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {account.backfilledVerification && <span className="chip">{t('signal.backfilled')}</span>}
                    {account.neverSignedIn && <span className="chip">{t('signal.neverSignedIn')}</span>}
                    {account.disposableDomain && <span className="chip">{t('signal.disposable')}</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{account.tenantCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
