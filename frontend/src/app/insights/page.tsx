'use client';

/**
 * /insights — the Standard, out-of-box HOME dashboard.
 *
 * This is the composed landing for Insights: it renders the widgets the user has
 * PINNED from anywhere in the app (their personal dashboard), with a shared time
 * window and an "Add widgets" catalogue. Every other Insights tab (AI, Delivery,
 * Finance…) is itself just another dashboard of widgets that can be pinned here —
 * and so is any chart from a non-insights surface. Pin a card → it appears here.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/PageContainer';
import { DaysWindowSelect } from '@/components/insights/LensShell';
import { WidgetGrid } from '@/components/widgets/WidgetGrid';
import { AddWidgetPicker } from '@/components/widgets/AddWidgetPicker';
import { usePins } from '@/lib/widgets/PinsProvider';

const btnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--coral-bright, #f4726e)', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
};

export default function InsightsHomePage() {
  const t = useTranslations('insights');
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();
  const { pinned, loading } = usePins();
  const [days, setDays] = useState(30);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
    else if (!hasTenant) router.replace('/tenants');
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;

  return (
    <PageContainer>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{t('home.title')}</h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4 }}>{t('home.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <DaysWindowSelect value={days} onChange={setDays} />
          <button type="button" style={btnStyle} onClick={() => setPicker(true)}>＋ {t('home.addWidgets')}</button>
        </div>
      </div>

      {pinned.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', background: 'var(--bg-elevated)', border: '1px dashed var(--border-subtle)', borderRadius: 12 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>📌</div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 6px' }}>{t('home.emptyTitle')}</h3>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: '0 0 16px', maxWidth: 460, marginInline: 'auto' }}>{t('home.emptyBody')}</p>
          {!loading && <button type="button" style={btnStyle} onClick={() => setPicker(true)}>＋ {t('home.addWidgets')}</button>}
        </div>
      ) : (
        <WidgetGrid ids={pinned} days={days} />
      )}

      <AddWidgetPicker open={picker} onClose={() => setPicker(false)} />
    </PageContainer>
  );
}
