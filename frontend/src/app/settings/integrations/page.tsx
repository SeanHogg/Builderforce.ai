'use client';

import { useState } from 'react';
import PageContainer from '@/components/PageContainer';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { ProviderKeysSettings } from '@/components/ProviderKeysSettings';
import type { LlmProvider } from '@/lib/builderforceApi';
import { IntegrationsGallery } from '@/components/integrations/IntegrationsGallery';
import { EmbedIntegrationSettings } from '@/components/settings/EmbedIntegrationSettings';
import ApiKeysContent from '../api-keys/page';
import { getStoredTenant } from '@/lib/auth';

type Category = 'all' | 'models' | 'apps' | 'developer' | 'embed';
const CATEGORIES: Array<{ id: Category; label: string; icon: string }> = [
  { id: 'all', label: 'All', icon: '' },
  { id: 'models', label: 'Model Providers', icon: '🧠' },
  { id: 'apps', label: 'App Integrations', icon: '🔌' },
  { id: 'developer', label: 'Developer API Keys', icon: '🔑' },
  { id: 'embed', label: 'Embed', icon: '⌗' },
];

const sectionHeading: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px' };
const PROVIDER_NAMES: Partial<Record<LlmProvider, string>> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', meta: 'Meta', kimi: 'Kimi', qwen: 'Qwen', minimax: 'MiniMax', xai: 'xAI' };

export default function SettingsIntegrationsPage() {
  const isOwner = getStoredTenant()?.role === 'owner';
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [priorityOrder, setPriorityOrder] = useState<LlmProvider[]>([]);
  const show = (id: Exclude<Category, 'all'>) => category === 'all' || category === id;

  return (
    <PageContainer width="full" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 750, color: 'var(--text-primary)', margin: '0 0 5px' }}>Integrations / API Keys</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Connect model providers and business tools, manage developer keys, and control provider priority from one place.</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingBottom: 16, marginBottom: 22, borderBottom: '1px solid var(--border-subtle)' }}>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search integrations and API keys…" aria-label="Search integrations and API keys" style={{ flex: '1 1 260px', maxWidth: 370, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13 }} />
        <span style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>Category</span>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {CATEGORIES.filter((item) => item.id !== 'developer' || isOwner).map((item) => (
            <button key={item.id} type="button" onClick={() => { setCategory(item.id); if (item.id !== 'all' && item.id !== 'models') setPriorityOpen(false); }} aria-pressed={category === item.id} style={{ padding: '8px 13px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: category === item.id ? 'var(--coral-bright)' : 'var(--bg-base)', color: category === item.id ? '#fff' : 'var(--text-secondary)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              {item.icon ? `${item.icon} ` : ''}{item.label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9 }}>
          {(category === 'all' || category === 'models') && (
            <button type="button" onClick={() => setPriorityOpen(true)} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 650, cursor: 'pointer' }}>
              ↕ Priority{priorityOrder[0] ? ` · ${PROVIDER_NAMES[priorityOrder[0]] ?? priorityOrder[0]}` : ' · None'}
            </button>
          )}
          <ViewToggle value={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {show('models') && <section style={{ marginBottom: 30 }}><h2 style={sectionHeading}>Model Providers</h2><ProviderKeysSettings search={search} viewMode={viewMode} priorityOpen={priorityOpen} onPriorityClose={() => setPriorityOpen(false)} onPriorityChange={setPriorityOrder} /></section>}
      {show('apps') && <section style={{ marginBottom: 30 }}><h2 style={sectionHeading}>App Integrations</h2><IntegrationsGallery search={search} viewMode={viewMode} /></section>}
      {isOwner && show('developer') && <section style={{ marginBottom: 30 }}><h2 style={sectionHeading}>Developer API Keys</h2><ApiKeysContent embedded showProviderKeys={false} search={search} externalViewMode={viewMode} /></section>}
      {show('embed') && <section style={{ marginBottom: 30 }}><h2 style={sectionHeading}>Embedded Integration</h2><EmbedIntegrationSettings /></section>}
    </PageContainer>
  );
}
