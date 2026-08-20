/**
 * WHERE THE MONEY GOES — recorded destinations, their verification, and whether this
 * person can actually be paid.
 *
 * ── THE SECRET NEVER COMES BACK ──────────────────────────────────────────────────
 * A provider's field DECLARATIONS come from the server (so the form knows what a bank
 * account looks like) and the masked label comes from the server (so the list can say
 * `•••• 4321`), but the value a person typed is write-only. This component therefore
 * renders a form it did not design and a label it cannot derive — which is exactly the
 * shape that keeps a credential out of the browser after it is saved.
 *
 * ── VERIFIED MEANS MONEY ARRIVED ─────────────────────────────────────────────────
 * The badge is derived on the server from whether a payout has actually completed
 * through the destination — not from a stored flag, and not from "you filled the form
 * in". A `failed` badge outranks a stale `verified` one, because a badge that remembers
 * the last success is a badge that lies about the next attempt.
 *
 * A real identity check (micro-deposits, KYC) needs a payout provider to perform it;
 * `verificationBlocked` says so instead of showing a step that can never complete.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { Select } from '@/components/Select';
import {
  addWithdrawalMethod,
  makeWithdrawalMethodDefault,
  removeWithdrawalMethod,
  type WithdrawalMethod,
  type WithdrawalMethodsView,
  type WithdrawalVerification,
} from '@/lib/earningsApi';

const VERIFICATION_TONE: Record<WithdrawalVerification, string> = {
  verified: 'var(--success)',
  unverified: 'var(--text-secondary)',
  failed: 'var(--danger)',
};

export function WithdrawalMethods({
  view,
  onChanged,
}: {
  view: WithdrawalMethodsView;
  onChanged: () => Promise<void> | void;
}) {
  const t = useTranslations('earnings');
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Only the providers whose credential is TYPED. A consent provider connects through
  // its own redirect, which owns the signed state; offering a second entrance to it
  // here would be a second place to get that wrong.
  const formProviders = useMemo(
    () => view.providers.filter((provider) => provider.connect === 'fields'),
    [view.providers],
  );
  const [providerName, setProviderName] = useState(() => formProviders[0]?.name ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});

  const provider = formProviders.find((candidate) => candidate.name === providerName) ?? null;

  const submit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!provider) return;
    setBusy(true);
    setNotice(null);
    try {
      await addWithdrawalMethod({
        provider: provider.name,
        fields,
        makeDefault: view.methods.length === 0,
      });
      setFields({});
      await onChanged();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [fields, onChanged, provider, view.methods.length]);

  const makeDefault = useCallback(async (method: WithdrawalMethod) => {
    setBusy(true);
    try {
      await makeWithdrawalMethodDefault(method.id);
      await onChanged();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  const remove = useCallback(async (method: WithdrawalMethod) => {
    // Removing where somebody's money goes is destructive and irreversible, which is
    // the narrow case that earns a centred confirmation.
    const ok = await confirm({
      title: t('removeMethodTitle'),
      message: t('removeMethodBody', { label: method.label }),
      confirmLabel: t('removeMethodConfirm'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await removeWithdrawalMethod(method.id);
      await onChanged();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [confirm, onChanged, t]);

  return (
    <section aria-label={t('methodsHeading')} style={{
      display: 'grid', gap: 14, padding: 18, borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-subtle)', background: 'var(--surface-card)',
    }}>
      <h2 style={{
        margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700,
        color: 'var(--text-primary)',
      }}>{t('methodsHeading')}</h2>

      {/* Readiness first: "can I be paid" is the question the whole panel answers, and
          burying it under a list of accounts makes a person work it out themselves. */}
      <p role="status" style={{
        margin: 0, color: view.readiness.ready ? 'var(--success)' : 'var(--warning-text)',
        fontSize: 'var(--font-size-small)',
      }}>
        {view.readiness.ready
          ? t('readyToBePaid')
          : t(`blocker.${view.readiness.blockers[0] ?? 'no_method'}`)}
      </p>

      {view.readiness.verificationBlocked && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-eyebrow)' }}>
          {t('verificationUnavailable')}
        </p>
      )}

      {view.methods.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {view.methods.map((method) => (
            <li key={method.id} style={{
              display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
              padding: '10px 12px', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
            }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: '1 1 160px', minWidth: 0 }}>
                {method.label}
              </span>
              <span style={{
                fontSize: 'var(--font-size-eyebrow)', fontWeight: 600,
                color: VERIFICATION_TONE[method.verification],
              }}>{t(`verification.${method.verification}`)}</span>
              {method.verificationDetail && (
                <span style={{ flexBasis: '100%', color: 'var(--danger)', fontSize: 'var(--font-size-eyebrow)' }}>
                  {method.verificationDetail}
                </span>
              )}
              {method.isDefault ? (
                <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)' }}>
                  {t('isDefault')}
                </span>
              ) : (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => makeDefault(method)}>
                  {t('makeDefault')}
                </button>
              )}
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => remove(method)}>
                {t('removeMethod')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {formProviders.length > 0 && (
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{
              fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600,
            }}>{t('providerLabel')}</span>
            <Select
              value={providerName}
              aria-label={t('providerLabel')}
              onChange={(event) => { setProviderName(event.target.value); setFields({}); }}
            >
              {formProviders.map((candidate) => (
                <option key={candidate.name} value={candidate.name}>{candidate.label}</option>
              ))}
            </Select>
          </label>
          {(provider?.fields ?? []).map((field) => (
            <label key={field.key} style={{ display: 'grid', gap: 4 }}>
              <span style={{
                fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)',
                textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600,
              }}>{field.label}{field.required ? ' *' : ''}</span>
              <input
                type={field.secret ? 'password' : 'text'}
                value={fields[field.key] ?? ''}
                placeholder={field.placeholder ?? ''}
                required={field.required}
                onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))}
                style={{
                  padding: '8px 10px', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-base)', color: 'var(--text-primary)',
                  maxWidth: '100%',
                }}
              />
            </label>
          ))}
          <button type="submit" className="btn btn-primary" disabled={busy || !provider}>
            {busy ? t('working') : t('addMethod')}
          </button>
        </form>
      )}

      {notice && (
        <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--font-size-small)' }}>{notice}</p>
      )}
    </section>
  );
}
