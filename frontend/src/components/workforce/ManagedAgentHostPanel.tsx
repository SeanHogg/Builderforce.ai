'use client';

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  billingApi,
  type ManagedAgentHostRequest,
  type ManagedAgentHostSubscription,
} from '@/lib/billingApi';
import { ApiRequestError } from '@/lib/apiClient';

const btn: CSSProperties = {
  minHeight: 44,
  minWidth: 44,
  padding: '8px 14px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-interactive)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};

const primaryBtn: CSSProperties = {
  ...btn,
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  borderColor: 'var(--accent)',
};

const field: CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '8px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-body)',
};

function statusLabel(
  t: ReturnType<typeof useTranslations>,
  status: ManagedAgentHostRequest['status'],
): string {
  switch (status) {
    case 'pending': return t('statusPending');
    case 'provisioning': return t('statusProvisioning');
    case 'active': return t('statusRequestActive');
    case 'cancelled': return t('statusCancelled');
    case 'failed': return t('statusFailed');
  }
}

export function ManagedAgentHostPanel({ tenantId }: { tenantId?: number }) {
  const t = useTranslations('billing.managedHost');
  const [entitlement, setEntitlement] = useState<ManagedAgentHostSubscription | null>(null);
  const [requests, setRequests] = useState<ManagedAgentHostRequest[]>([]);
  const [name, setName] = useState('');
  const [region, setRegion] = useState('us-east');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (tenantId == null) return;
    setError(null);
    try {
      const [{ subscription }, listed] = await Promise.all([
        billingApi.managedAgentHost(tenantId),
        billingApi.listManagedAgentHostRequests(),
      ]);
      setEntitlement(subscription);
      setRequests(listed.requests);
    } catch {
      setError(t('loadFailed'));
    }
  }, [t, tenantId]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await billingApi.requestManagedAgentHost({
        agentHostName: name.trim(),
        region: region.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setName(''); setNotes('');
      await load();
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 403) setError(t('unpaid'));
      else if (cause instanceof ApiRequestError && cause.status === 409) setError(t('exhausted'));
      else setError(t('requestFailed'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: number) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await billingApi.cancelManagedAgentHostRequest(id);
      await load();
    } catch {
      setError(t('cancelFailed'));
    } finally {
      setBusy(false);
    }
  };

  const paid = entitlement?.status === 'active';

  return (
    <section
      aria-labelledby="managed-agent-host-title"
      style={{
        marginBottom: 16,
        padding: 16,
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-elevated)',
        display: 'grid',
        gap: 12,
        maxWidth: 720,
      }}
    >
      <div>
        <h2 id="managed-agent-host-title" style={{ margin: 0, fontSize: 'var(--font-size-section)' }}>{t('title')}</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('description')}</p>
      </div>
      {error && <p role="alert" style={{ margin: 0, color: 'var(--error-text)', fontSize: 'var(--font-size-small)' }}>{error}</p>}
      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
        {paid
          ? `${t('statusActive')} · ${t('quantityCovered')}: ${entitlement.quantity}`
          : entitlement?.status === 'past_due'
            ? t('statusPastDue')
            : t('statusNone')}
      </p>
      {!paid && (
        <Link href="/pricing" style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', textDecoration: 'none', width: 'fit-content' }}>
          {t('cta')}
        </Link>
      )}
      {paid && (
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
            {t('name')}
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={255} style={field} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
            {t('region')}
            <input value={region} onChange={(e) => setRegion(e.target.value)} maxLength={100} style={field} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
            {t('notes')}
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...field, minHeight: 88 }} />
          </label>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('provisionNote')}</p>
          <button type="submit" disabled={busy || !name.trim()} style={primaryBtn}>{busy ? t('busy') : t('submit')}</button>
        </form>
      )}
      <div>
        <h3 style={{ margin: '8px 0', fontSize: 'var(--font-size-body)' }}>{t('requests')}</h3>
        {requests.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('empty')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {requests.map((request) => (
              <li key={request.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ color: 'var(--text-primary)' }}>
                  {request.agentHostName} · {statusLabel(t, request.status)}
                  {request.region ? ` · ${request.region}` : ''}
                </span>
                {request.status === 'pending' && (
                  <button type="button" onClick={() => void cancel(request.id)} disabled={busy} style={btn}>{t('cancel')}</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
