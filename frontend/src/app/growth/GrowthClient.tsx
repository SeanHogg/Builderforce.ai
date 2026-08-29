'use client';

/**
 * Growth — market the thing you just built.
 *
 * Shell only: reads `?tab=` (the shared `<ShellIndex>` sub-nav drives it, mirroring
 * Quality/Investor) and swaps in the active section. Each section owns its own
 * data and state — see `@/components/growth/*Section.tsx`.
 */

import type { ComponentType } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MailboxesSection } from '@/components/growth/MailboxesSection';
import { AudiencesSection } from '@/components/growth/AudiencesSection';
import { SendersSection } from '@/components/growth/SendersSection';
import { BrandSection } from '@/components/growth/BrandSection';
import { TemplatesSection } from '@/components/growth/TemplatesSection';
import { CampaignsSection } from '@/components/growth/CampaignsSection';

interface TabEntry {
  titleKey: string;
  descriptionKey: string;
  Body: ComponentType;
}

/** Keyed by the `?tab=` id — must mirror the `growth` entry's `tabs` in navGroups.ts. */
const GROWTH_TABS: Record<string, TabEntry> = {
  '': { titleKey: 'mailboxes.title', descriptionKey: 'mailboxes.description', Body: MailboxesSection },
  audiences: { titleKey: 'audiences.title', descriptionKey: 'audiences.description', Body: AudiencesSection },
  senders: { titleKey: 'senders.title', descriptionKey: 'senders.description', Body: SendersSection },
  brand: { titleKey: 'brand.title', descriptionKey: 'brand.description', Body: BrandSection },
  templates: { titleKey: 'templates.title', descriptionKey: 'templates.description', Body: TemplatesSection },
  campaigns: { titleKey: 'campaigns.title', descriptionKey: 'campaigns.description', Body: CampaignsSection },
};

const page: React.CSSProperties = {
  padding: 'clamp(16px, 4vw, 32px)',
  maxWidth: '80rem',
  margin: '0 auto',
  color: 'var(--text-primary, var(--bg-elevated))',
};

export function GrowthClient() {
  const t = useTranslations('growth');
  const tab = useSearchParams().get('tab') ?? '';
  const entry = GROWTH_TABS[tab] ?? GROWTH_TABS[''];
  const { Body } = entry;

  return (
    <main style={page}>
      <h1 style={{ fontSize: 'clamp(1.4rem, 4vw, 1.9rem)', margin: 0 }}>{t(entry.titleKey)}</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>{t(entry.descriptionKey)}</p>
      <div style={{ marginTop: 20 }}>
        <Body />
      </div>
    </main>
  );
}
