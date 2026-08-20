'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminPricingDocument } from '@/lib/adminApi';
import { AdminError, AdminLoading, errText } from '@/components/admin/adminShared';
import { useAdminFormat } from '@/components/admin/adminShared';
import { invalidatePublicPricingRequest } from '@/lib/publicPricing';

export default function PricingPanel() {
  const { fmtDateTime } = useAdminFormat();
  const t = useTranslations('admin.pricing');
  const [draft, setDraft] = useState<AdminPricingDocument | null>(null);
  const [publishedAt, setPublishedAt] = useState('');
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    adminApi.pricing().then(({ draft, published }) => { setDraft(draft); setPublishedAt(published.publishedAt); }).catch((e) => setError(errText(e)));
  }, []);

  if (!draft) return error ? <AdminError message={error} /> : <AdminLoading />;
  const updatePlan = (index: number, patch: Partial<AdminPricingDocument['plans'][number]>) => setDraft((current) => current && ({ ...current, plans: current.plans.map((plan, i) => i === index ? { ...plan, ...patch } : plan) }));

  const save = async () => {
    setBusy('save'); setError('');
    try { const result = await adminApi.savePricingDraft(draft); setDraft(result.draft); setSaved(true); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(null); }
  };
  const publish = async () => {
    setBusy('publish'); setError('');
    try {
      await adminApi.savePricingDraft(draft);
      const result = await adminApi.publishPricing();
      invalidatePublicPricingRequest();
      setPublishedAt(result.published.publishedAt); setSaved(false);
    } catch (e) { setError(errText(e)); }
    finally { setBusy(null); }
  };

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
    <AdminError message={error} />
    <div className="health-card">
      <h2 style={{ marginTop: 0 }}>{t('title')}</h2>
      <p className="text-muted">{t('description')}</p>
      <p className="text-muted">{t('publishedAt', { date: publishedAt ? fmtDateTime(publishedAt) : '—' })}</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label>{t('currency')}<input className="input" value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} style={{ display: 'block', marginTop: 4, width: 100 }} /></label>
        <label>{t('managedHost')}<input className="input" type="number" min={0} value={draft.managedAgentHostMonthly} onChange={(e) => setDraft({ ...draft, managedAgentHostMonthly: Number(e.target.value) })} style={{ display: 'block', marginTop: 4, width: 150 }} /></label>
      </div>
    </div>
    {draft.plans.map((plan, index) => <div className="health-card" key={plan.id} style={{ display: 'grid', gap: 10 }}>
      <h3 style={{ margin: 0 }}>{plan.name}</h3>
      <label>{t('name')}<input className="input" value={plan.name} onChange={(e) => updatePlan(index, { name: e.target.value })} style={{ display: 'block', width: '100%', marginTop: 4 }} /></label>
      <label>{t('descriptionLabel')}<textarea className="input" value={plan.description} onChange={(e) => updatePlan(index, { description: e.target.value })} rows={2} style={{ display: 'block', width: '100%', marginTop: 4 }} /></label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label>{t('monthly')}<input className="input" type="number" min={0} value={plan.monthly} onChange={(e) => updatePlan(index, { monthly: Number(e.target.value) })} style={{ display: 'block', width: 110, marginTop: 4 }} /></label>
        <label>{t('yearly')}<input className="input" type="number" min={0} value={plan.yearly} onChange={(e) => updatePlan(index, { yearly: Number(e.target.value) })} style={{ display: 'block', width: 110, marginTop: 4 }} /></label>
        <label>{t('suffix')}<input className="input" value={plan.priceSuffix} onChange={(e) => updatePlan(index, { priceSuffix: e.target.value })} style={{ display: 'block', width: 150, marginTop: 4 }} /></label>
        <label>{t('minimumSeats')}<input className="input" type="number" min={1} value={plan.minimumSeats} onChange={(e) => updatePlan(index, { minimumSeats: Number(e.target.value) })} style={{ display: 'block', width: 100, marginTop: 4 }} /></label>
      </div>
      <label>{t('features')}<textarea className="input" value={plan.features.join('\n')} onChange={(e) => updatePlan(index, { features: e.target.value.split('\n').filter(Boolean) })} rows={7} style={{ display: 'block', width: '100%', marginTop: 4 }} /></label>
      <label>{t('excluded')}<textarea className="input" value={plan.excluded.join('\n')} onChange={(e) => updatePlan(index, { excluded: e.target.value.split('\n').filter(Boolean) })} rows={3} style={{ display: 'block', width: '100%', marginTop: 4 }} /></label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label>{t('ctaLabel')}<input className="input" value={plan.ctaLabel} onChange={(e) => updatePlan(index, { ctaLabel: e.target.value })} style={{ display: 'block', marginTop: 4 }} /></label>
        <label>{t('ctaHref')}<input className="input" value={plan.ctaHref} onChange={(e) => updatePlan(index, { ctaHref: e.target.value })} style={{ display: 'block', marginTop: 4 }} /></label>
      </div>
    </div>)}
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <button className="btn-ghost" type="button" disabled={busy !== null} onClick={save}>{busy === 'save' ? t('saving') : t('saveDraft')}</button>
      <button className="btn-primary" type="button" disabled={busy !== null} onClick={publish}>{busy === 'publish' ? t('publishing') : t('publish')}</button>
      {saved && <span className="text-muted">{t('draftSaved')}</span>}
    </div>
  </div>;
}
