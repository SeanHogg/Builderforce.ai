'use client';

/**
 * PublishToMarketplaceModal — the CORE "publish a work item for hire" dialog,
 * opened from the task drawer. Lets a manager choose how the ticket is offered
 * (posting + engagement type), prefills the requirements from the ticket
 * description, sets an optional budget range + visibility, and calls
 * POST /api/marketplace/publish. Theme-safe (CSS variables only) and fluid.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Select } from '@/components/Select';
import { publishTicket, type PostingType, type EngagementType, type TicketPosting } from '@/lib/freelancerApi';

const input: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
  borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' };
const btn = (primary: boolean): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: primary ? 'none' : '1px solid var(--border-subtle)',
  background: primary ? 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))' : 'var(--bg-elevated)',
  color: primary ? '#fff' : 'var(--text-primary)',
});

const POSTING_TYPES: PostingType[] = ['project_bid', 'design', 'fte'];
const ENGAGEMENT_TYPES: EngagementType[] = ['fixed_bid', 'hourly', 'fte'];

export function PublishToMarketplaceModal({
  ticketId, defaultRequirements, onClose, onPublished,
}: {
  ticketId: number;
  defaultRequirements?: string;
  onClose: () => void;
  onPublished: (posting: TicketPosting) => void;
}) {
  const t = useTranslations('gigs');
  const [postingType, setPostingType] = useState<PostingType>('project_bid');
  const [engagementType, setEngagementType] = useState<EngagementType>('fixed_bid');
  const [requirements, setRequirements] = useState(defaultRequirements ?? '');
  const [rateMin, setRateMin] = useState('');
  const [rateMax, setRateMax] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A full-time role is billed as FTE — keep the two selects consistent.
  const pickPosting = (v: PostingType) => {
    setPostingType(v);
    if (v === 'fte') setEngagementType('fte');
    else if (engagementType === 'fte') setEngagementType('fixed_bid');
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const { posting } = await publishTicket({
        ticketId, postingType, engagementType,
        requirements: requirements.trim() || undefined,
        rateMinCents: rateMin ? Math.round(parseFloat(rateMin) * 100) : undefined,
        rateMaxCents: rateMax ? Math.round(parseFloat(rateMax) * 100) : undefined,
        visibility,
      });
      onPublished(posting);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('publish.publishError'));
    } finally { setBusy(false); }
  };

  return (
    <SlideOutPanel open onClose={onClose} title={t('publish.modalTitle')} width="min(560px, 96vw)">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('publish.modalSubtitle')}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <div>
            <label style={labelStyle} htmlFor="mkt-posting">{t('publish.postingType')}</label>
            <Select id="mkt-posting" style={input} value={postingType} onChange={(e) => pickPosting(e.target.value as PostingType)}>
              {POSTING_TYPES.map((v) => <option key={v} value={v}>{t(`postingType.${v}`)}</option>)}
            </Select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="mkt-engagement">{t('publish.engagementType')}</label>
            <Select id="mkt-engagement" style={input} value={engagementType} onChange={(e) => setEngagementType(e.target.value as EngagementType)} disabled={postingType === 'fte'}>
              {ENGAGEMENT_TYPES.map((v) => <option key={v} value={v}>{t(`engagementType.${v}`)}</option>)}
            </Select>
          </div>
        </div>

        <div>
          <label style={labelStyle} htmlFor="mkt-req">{t('publish.requirements')}</label>
          <textarea id="mkt-req" style={{ ...input, minHeight: 90, resize: 'vertical', fontFamily: 'inherit' }}
            placeholder={t('publish.requirementsPlaceholder')} value={requirements} onChange={(e) => setRequirements(e.target.value)} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <div>
            <label style={labelStyle} htmlFor="mkt-min">{t('publish.rateMin')}</label>
            <input id="mkt-min" style={input} type="number" min={0} value={rateMin} onChange={(e) => setRateMin(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="mkt-max">{t('publish.rateMax')}</label>
            <input id="mkt-max" style={input} type="number" min={0} value={rateMax} onChange={(e) => setRateMax(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="mkt-vis">{t('publish.visibility')}</label>
            <Select id="mkt-vis" style={input} value={visibility} onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}>
              <option value="public">{t('visibility.public')}</option>
              <option value="private">{t('visibility.private')}</option>
            </Select>
          </div>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>{t('publish.rateHint')}</p>

        {error && <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" style={btn(false)} onClick={onClose}>{t('publish.cancel')}</button>
          <button type="button" style={{ ...btn(true), opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={submit}>
            {busy ? t('publish.publishing') : t('publish.publishBtn')}
          </button>
        </div>
      </div>
    </SlideOutPanel>
  );
}
