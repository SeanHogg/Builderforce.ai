'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { type ViewMode } from '@/components/ViewToggle';
import { CatalogToolbar } from '@/components/CatalogToolbar';
import { ProviderKeysSettings } from '@/components/ProviderKeysSettings';
import { IntegrationsGallery } from '@/components/integrations/IntegrationsGallery';
import { MailboxIntegrations } from '@/components/integrations/MailboxIntegrations';
import { ConnectorsGallery } from '@/components/connectors/ConnectorsGallery';
import { ApiKeysContent } from '@/components/settings/ApiKeysContent';
import { PayoutConnections } from '@/components/payouts/PayoutConnections';
import { getStoredTenant } from '@/lib/auth';
import { Icon } from '@/components/ui/Icon';

type Category = 'all' | 'models' | 'connectors' | 'apps' | 'payments' | 'developer';
const CATEGORIES: Array<{ id: Category; icon: string }> = [
  { id: 'all', icon: '' },
  { id: 'models', icon: '🧠' },
  // Connectors are the BREADTH surface (declarative manifests, any HTTPS API);
  // "apps" below is the narrower set of two-way synced board providers. They are
  // separate sections because connecting Jira as a board and calling Jira's API as
  // a tool are different jobs with different contracts.
  { id: 'connectors', icon: '🔗' },
  { id: 'apps', icon: '🔌' },
  // Money OUT. Its own category rather than a card inside "apps" because the
  // question is different in kind: every other connection here reads or writes
  // data, and this one moves funds to a bank account somebody owns.
  { id: 'payments', icon: '🏦' },
  { id: 'developer', icon: '🔑' },
];

const sectionHeading: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px' };

export default function SettingsIntegrationsPage() {
  const t = useTranslations('integrations.page');
  const isOwner = getStoredTenant()?.role === 'owner';
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [priorityOpen, setPriorityOpen] = useState(false);
  // The LABEL of whatever leads the BYO precedence list — a connected provider OR a named
  // OpenRouter connection. Formatted by ProviderKeysSettings (the owner of that list) so
  // this chip and the drawer can never name different leaders.
  const [priorityLeader, setPriorityLeader] = useState<string | null>(null);
  const show = (id: Exclude<Category, 'all'>) => category === 'all' || category === id;

  return (
    <PageContainer width="full" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 750, color: 'var(--text-primary)', margin: '0 0 5px' }}>{t('title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('subtitle')}</p>
      </div>

      {/* `sticky` keeps search/category/priority filtering reachable while the
          Model Providers / Connectors / Apps sections scroll underneath — the
          same shared toolbar the marketplace/prompts/blog catalogues use. */}
      <CatalogToolbar
        sticky
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t('searchPlaceholder')}
        view={viewMode}
        onView={setViewMode}
      >
        <span style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>{t('categoryLabel')}</span>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {CATEGORIES.filter((item) => item.id !== 'developer' || isOwner).map((item) => (
            <button key={item.id} type="button" onClick={() => { setCategory(item.id); if (item.id !== 'all' && item.id !== 'models') setPriorityOpen(false); }} aria-pressed={category === item.id} style={{ padding: '8px 13px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: category === item.id ? 'var(--coral-bright)' : 'var(--bg-base)', color: category === item.id ? 'var(--text-on-accent)' : 'var(--text-secondary)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              {item.icon && <Icon source={item.icon} size={16} style={{ marginRight: 6 }} />}{t(`category.${item.id}`)}
            </button>
          ))}
        </div>
        {(category === 'all' || category === 'models') && (
          <button type="button" onClick={() => setPriorityOpen(true)} style={{ padding: '7px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 650, cursor: 'pointer' }}>
            {t('priorityChip', { leader: priorityLeader ?? t('priorityNone') })}
          </button>
        )}
      </CatalogToolbar>

      {show('models') && <section style={{ marginBottom: 30 }}><h2 style={sectionHeading}>{t('category.models')}</h2><ProviderKeysSettings search={search} viewMode={viewMode} priorityOpen={priorityOpen} onPriorityClose={() => setPriorityOpen(false)} onLeaderChange={setPriorityLeader} /></section>}
      {show('connectors') && <section style={{ marginBottom: 30 }}><h2 style={sectionHeading}>{t('category.connectors')}</h2><ConnectorsGallery search={search} viewMode={viewMode} /></section>}
      {show('apps') && <section style={{ marginBottom: 30 }}><h2 style={sectionHeading}>{t('category.apps')}</h2><MailboxIntegrations search={search} viewMode={viewMode} /><IntegrationsGallery search={search} viewMode={viewMode} /></section>}
      {/* The SAME component `/billing/payouts` and the Sales Hub render — one
          surface for "where does my money go", reached from three doors. */}
      {show('payments') && <section style={{ marginBottom: 30 }}><h2 style={sectionHeading}>{t('category.payments')}</h2><p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>{t('paymentsIntro')}</p><PayoutConnections returnTo="/settings/integrations" search={search} /></section>}
      {isOwner && show('developer') && <section style={{ marginBottom: 30 }}><h2 style={sectionHeading}>{t('category.developer')}</h2><ApiKeysContent embedded showProviderKeys={false} search={search} externalViewMode={viewMode} /></section>}
    </PageContainer>
  );
}
