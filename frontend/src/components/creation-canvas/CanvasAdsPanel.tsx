'use client';

/**
 * The workspace's PAID media, managed on the canvas.
 *
 * Three jobs, in the order a CMO actually does them: CONNECT the ad accounts, LAUNCH or
 * steer a campaign — and, from any campaign, name the AUDIENCE and the CREATIVE beneath
 * it — and MEASURE what it cost and returned.
 *
 * ── WHAT THIS FILE IS, AND IS NOT ───────────────────────────────────────────
 * It is the SHELL: a title, a tab strip and the tab that is open. Nothing else. Each job
 * is its own component under `./ads`, owning its own state, its own reads and its own
 * entitlement decisions, because this file had become the thing that grows every time
 * paid media gains a level — it already held three jobs' worth of state in one component
 * and the ad-set tier would have been the fourth.
 *
 * The three levels of the ads hierarchy therefore mirror the server's own split exactly:
 * `AdCampaignsTab` over `adsService`, `AdSetTier` / `AdTier` over `adSetService`. A new
 * targeting dimension changes one file at each layer and nothing here.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import { PanelTabs } from './PanelTabs';
import { AdAccountsTab } from './ads/AdAccountsTab';
import { AdCampaignsTab } from './ads/AdCampaignsTab';
import { AdInsightsTab } from './ads/AdInsightsTab';
import { useAdAccounts } from '@/lib/ads/useAdAccounts';

type Mode = 'accounts' | 'campaigns' | 'insights';

export interface CanvasAdsPanelProps {
  onClose: () => void;
}

export function CanvasAdsPanel({ onClose }: CanvasAdsPanelProps) {
  const t = useTranslations('canvas.ads');
  const { ready, loading } = useAdAccounts();
  const [chosen, setChosen] = useState<Mode | null>(null);

  // Opens on the job there is one to do: accounts when nothing can spend yet, campaigns
  // once something can. A person who has picked a tab keeps it — the default answers the
  // first render, it does not follow the data around afterwards.
  const mode: Mode = chosen ?? (!loading && ready.length > 0 ? 'campaigns' : 'accounts');

  return (
    <aside className={styles.drivePanel} aria-label={t('title')}>
      <header>
        <strong>{t('title')}</strong>
        <button type="button" aria-label={t('close')} title={t('close')} onClick={onClose}>×</button>
      </header>

      <PanelTabs<Mode>
        label={t('title')}
        value={mode}
        onChange={setChosen}
        tabs={[
          { id: 'accounts', label: t('tabAccounts') },
          { id: 'campaigns', label: t('tabCampaigns') },
          { id: 'insights', label: t('tabInsights') },
        ]}
      />

      {mode === 'accounts' && <AdAccountsTab />}
      {mode === 'campaigns' && <AdCampaignsTab />}
      {mode === 'insights' && <AdInsightsTab />}
    </aside>
  );
}
