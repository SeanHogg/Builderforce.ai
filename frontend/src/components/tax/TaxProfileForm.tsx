'use client';

/**
 * A payee's own W-9/W-8 form — self-service, own state, own fetch.
 *
 * Every field here except the tax id itself IS the profile: submitting re-sends
 * the whole form and the server merges it, so the id is the one field this
 * component treats specially — it is never pre-filled (the API never returns
 * it), the input clears itself after a successful save, and the last-four the
 * server echoes back is shown as confirmation, not as an editable value.
 *
 * Self-contained: it loads its own options + profile, owns its own draft state,
 * and reports nothing upward — a page embeds it with zero props.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { taxApi, type TaxProfile, type TaxProfileOptions } from '@/lib/taxApi';

const fieldLabel: React.CSSProperties = {
  fontSize: 'var(--font-size-field-label)', fontWeight: 600, color: 'var(--text-secondary)',
};

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 'var(--font-size-body)', minHeight: 40,
  width: '100%',
};

type Draft = {
  entityType: string;
  legalName: string;
  businessName: string;
  addressLine1: string;
  addressLine2: string;
  addressCity: string;
  addressRegion: string;
  addressPostalCode: string;
  addressCountry: string;
  taxResidencyCountry: string;
  taxIdType: string;
  taxId: string;
};

const emptyDraft: Draft = {
  entityType: '', legalName: '', businessName: '',
  addressLine1: '', addressLine2: '', addressCity: '', addressRegion: '', addressPostalCode: '', addressCountry: '',
  taxResidencyCountry: '', taxIdType: '', taxId: '',
};

function draftFrom(profile: TaxProfile): Draft {
  return {
    entityType: profile.entityType ?? '',
    legalName: profile.legalName ?? '',
    businessName: profile.businessName ?? '',
    addressLine1: profile.addressLine1 ?? '',
    addressLine2: profile.addressLine2 ?? '',
    addressCity: profile.addressCity ?? '',
    addressRegion: profile.addressRegion ?? '',
    addressPostalCode: profile.addressPostalCode ?? '',
    addressCountry: profile.addressCountry ?? '',
    taxResidencyCountry: profile.taxResidencyCountry ?? '',
    taxIdType: profile.taxIdType ?? '',
    taxId: '',
  };
}

export function TaxProfileForm() {
  const t = useTranslations('tax');
  const [options, setOptions] = useState<TaxProfileOptions | null>(null);
  const [profile, setProfile] = useState<TaxProfile | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [opts, p] = await Promise.all([taxApi.options(), taxApi.profile()]);
      setOptions(opts);
      setProfile(p);
      setDraft(draftFrom(p));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof Draft>(key: K) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setSaved(false);
    try {
      const next = await taxApi.saveProfile({
        entityType: draft.entityType || undefined,
        legalName: draft.legalName || undefined,
        businessName: draft.businessName || undefined,
        addressLine1: draft.addressLine1 || undefined,
        addressLine2: draft.addressLine2 || undefined,
        addressCity: draft.addressCity || undefined,
        addressRegion: draft.addressRegion || undefined,
        addressPostalCode: draft.addressPostalCode || undefined,
        addressCountry: draft.addressCountry || undefined,
        taxResidencyCountry: draft.taxResidencyCountry || undefined,
        taxIdType: draft.taxIdType || undefined,
        // Omit entirely when blank, so a re-save without retyping the id leaves
        // the sealed value untouched rather than clearing it.
        taxId: draft.taxId || undefined,
      });
      setProfile(next);
      setDraft(draftFrom(next));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('loading')}</p>;
  if (!options || !profile) return null;

  return (
    <form onSubmit={(event) => void submit(event)} style={{ display: 'grid', gap: 14 }}>
      {error && <p role="alert" style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)', margin: 0 }}>{error}</p>}
      {saved && !error && <p role="status" style={{ color: 'var(--success)', fontSize: 'var(--font-size-small)', margin: 0 }}>{t('saved')}</p>}

      {profile.hasTaxId && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', margin: 0 }}>
          {t('idOnFile', { last4: profile.taxIdLast4 ?? '····' })}
        </p>
      )}
      {!profile.complete && (
        <p style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)', margin: 0 }}>{t('incomplete')}</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 14 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={fieldLabel}>{t('entityType')} *</span>
          <select value={draft.entityType} onChange={set('entityType')} required style={inputStyle}>
            <option value="">{t('selectOne')}</option>
            {options.entityTypes.map((et) => <option key={et} value={et}>{t(`entityTypeOption.${et}`)}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={fieldLabel}>{t('legalName')} *</span>
          <input value={draft.legalName} onChange={set('legalName')} required style={inputStyle} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={fieldLabel}>{t('businessName')}</span>
          <input value={draft.businessName} onChange={set('businessName')} style={inputStyle} />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 14 }}>
        <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
          <span style={fieldLabel}>{t('addressLine1')} *</span>
          <input value={draft.addressLine1} onChange={set('addressLine1')} required style={inputStyle} />
        </label>
        <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
          <span style={fieldLabel}>{t('addressLine2')}</span>
          <input value={draft.addressLine2} onChange={set('addressLine2')} style={inputStyle} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={fieldLabel}>{t('addressCity')} *</span>
          <input value={draft.addressCity} onChange={set('addressCity')} required style={inputStyle} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={fieldLabel}>{t('addressRegion')}</span>
          <input value={draft.addressRegion} onChange={set('addressRegion')} style={inputStyle} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={fieldLabel}>{t('addressPostalCode')}</span>
          <input value={draft.addressPostalCode} onChange={set('addressPostalCode')} style={inputStyle} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={fieldLabel}>{t('addressCountry')} *</span>
          <input value={draft.addressCountry} onChange={set('addressCountry')} required maxLength={2} placeholder="US" style={inputStyle} />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 14 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={fieldLabel}>{t('taxResidencyCountry')} *</span>
          <input value={draft.taxResidencyCountry} onChange={set('taxResidencyCountry')} required maxLength={2} placeholder="US" style={inputStyle} />
          <small style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-eyebrow)' }}>{t('residencyHelp')}</small>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={fieldLabel}>{t('taxIdType')}</span>
          <select value={draft.taxIdType} onChange={set('taxIdType')} style={inputStyle}>
            <option value="">{t('selectOne')}</option>
            {options.taxIdTypes.map((it) => <option key={it} value={it}>{t(`taxIdTypeOption.${it}`)}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={fieldLabel}>{profile.hasTaxId ? t('taxIdReplace') : t('taxId')}{profile.hasTaxId ? '' : ' *'}</span>
          <input
            type="password"
            autoComplete="off"
            value={draft.taxId}
            onChange={set('taxId')}
            required={!profile.hasTaxId}
            placeholder={profile.hasTaxId ? t('taxIdPlaceholderOnFile') : ''}
            style={inputStyle}
          />
          <small style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-eyebrow)' }}>{t('taxIdHelp')}</small>
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="submit" variant="primary" loading={busy}>{t('save')}</Button>
      </div>
    </form>
  );
}

export default TaxProfileForm;
