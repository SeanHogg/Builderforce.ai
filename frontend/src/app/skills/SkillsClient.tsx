'use client';

import { Icon } from '@/components/ui/Icon';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import {
  artifactAssignments,
  marketplaceStats,
  agentHosts,
  listMarketplaceSkills,
  type ArtifactStats,
} from '@/lib/builderforceApi';
import { BUILTIN_SKILLS } from '@/lib/marketplaceData';
import ArtifactAssigner from '@/components/ArtifactAssigner';
import { CatalogInsightsBar, type CatalogInsightsItem } from '@/components/CatalogInsightsBar';
import PageContainer from '@/components/PageContainer';
import { WorkspaceSkillReview } from '@/components/skills/WorkspaceSkillReview';
import { WorkspaceSkillAuthor } from '@/components/skills/WorkspaceSkillAuthor';
import type { WorkspaceSkillStatus } from '@/lib/workspaceSkillsApi';
import { SkillAssignmentsContent } from '@/components/SkillAssignmentsContent';
import { Collection } from '@/components/collection/Collection';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import { useLocalSource } from '@/components/collection/sources';
import { useCollectionSort } from '@/components/collection/useCollectionSort';
import { useCollectionPaging } from '@/components/collection/useCollectionPaging';
import { useCollectionPreferences } from '@/components/collection/collectionPreferences';
import { useErrorText } from '@/i18n/useErrorMessage';
type SkillItem = { slug: string; name: string; description: string; category?: string; icon?: string; emoji?: string; author?: string };

export default function SkillsPage() {
  const t = useTranslations('skillsPage');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? '';
  const tenantNum = Number(tenantId);

  const [tab, setTab] = useState<'assigned' | 'marketplace' | 'workspace'>('assigned');
  // Which review filter the workspace tab opens on — a skill a person just wrote is
  // approved on arrival, so after saving one the tab opens where it landed.
  const [workspaceView, setWorkspaceView] = useState<{ status: WorkspaceSkillStatus; key: number }>({ status: 'draft', key: 0 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apiSkills, setApiSkills] = useState<SkillItem[]>([]);
  const [assigned, setAssigned] = useState<{ slug: string; name: string }[]>([]);
  const [stats, setStats] = useState<Record<string, ArtifactStats>>({});
  const [hasAgentHosts, setHasAgentHosts] = useState(true);
  const [installedSlugs, setInstalledSlugs] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [agentHostList, assignList, res] = await Promise.all([
        agentHosts.list().catch(() => []),
        tenantNum ? artifactAssignments.list('tenant', tenantNum, 'skill').catch(() => []) : [],
        listMarketplaceSkills({ limit: 100 }).catch(() => ({ skills: [] })),
      ]);
      setHasAgentHosts(agentHostList.length > 0);
      setAssigned(assignList.map((a) => ({ slug: a.artifactSlug, name: a.artifactSlug })));
      setInstalledSlugs(new Set(assignList.map((a) => a.artifactSlug)));
      setApiSkills((res.skills ?? []).map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description ?? '',
        category: s.category ?? undefined,
        icon: s.icon_url ?? undefined,
        author: s.author_username ?? s.author_display_name,
      })));
      const allSlugs = [
        ...BUILTIN_SKILLS.map((b) => b.slug),
        ...(res.skills ?? []).map((s) => s.slug),
      ];
      if (allSlugs.length > 0) {
        const s = await marketplaceStats.getStats('skill', allSlugs).catch(() => ({}));
        setStats(s);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [tenantNum, errorText]);

  useEffect(() => {
    load();
  }, [load]);

  const assign = async (slug: string) => {
    if (!tenantNum) return;
    try {
      await artifactAssignments.assign('skill', slug, 'tenant', tenantNum);
      setInstalledSlugs((prev) => new Set([...prev, slug]));
      const updated = await marketplaceStats.getStats('skill', [slug]).catch(() => ({}));
      setStats((s) => ({ ...s, ...updated }));
      setAssigned((prev) => {
        const name = BUILTIN_SKILLS.find((b) => b.slug === slug)?.name ?? apiSkills.find((a) => a.slug === slug)?.name ?? slug;
        if (prev.some((a) => a.slug === slug)) return prev;
        return [...prev, { slug, name }];
      });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const unassign = async (slug: string) => {
    if (!tenantNum) return;
    try {
      await artifactAssignments.unassign('skill', slug, 'tenant', tenantNum);
      setInstalledSlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
      setAssigned((prev) => prev.filter((a) => a.slug !== slug));
      const updated = await marketplaceStats.getStats('skill', [slug]).catch(() => ({}));
      setStats((s) => ({ ...s, ...updated }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const toggleLike = async (slug: string) => {
    try {
      const liked = await marketplaceStats.toggleLike('skill', slug);
      const prev = stats[slug] ?? { likes: 0, installs: 0, liked: false };
      setStats((s) => ({ ...s, [slug]: { ...prev, liked, likes: liked ? prev.likes + 1 : Math.max(0, prev.likes - 1) } }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const builtinFiltered = BUILTIN_SKILLS.filter(
    (b) => !search || b.name.toLowerCase().includes(search.toLowerCase()) || b.description.toLowerCase().includes(search.toLowerCase())
  );
  const apiFiltered = apiSkills.filter(
    (s) => !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.description ?? '').toLowerCase().includes(search.toLowerCase())
  );
  const apiSlugSet = new Set(apiFiltered.map((s) => s.slug));
  const marketplaceItems: SkillItem[] = [
    ...apiFiltered,
    ...builtinFiltered.filter((b) => !apiSlugSet.has(b.slug)).map((b) => ({ slug: b.slug, name: b.name, description: b.description, category: b.category, icon: b.image, emoji: b.emoji, author: b.author })),
  ];

  const insightsItems: CatalogInsightsItem[] = marketplaceItems.map((s) => {
    const stat = stats[s.slug] ?? { likes: 0, installs: 0, liked: false };
    return { key: s.slug, name: s.name, group: s.category ?? null, primary: stat.installs, secondary: stat.likes };
  });

  const renderActions = (s: SkillItem) => {
    const installed = installedSlugs.has(s.slug);
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {installed ? <button type="button" className="btn btn-danger btn-sm" onClick={() => unassign(s.slug)}>{t('uninstall')}</button> : <button type="button" className="btn btn-primary btn-sm" onClick={() => assign(s.slug)}>{t('install')}</button>}
        <ArtifactAssigner artifactType="skill" artifactSlug={s.slug} artifactName={s.name} />
        <Link href={`/skills/${encodeURIComponent(s.slug)}`} className="btn btn-secondary btn-sm">{tc('view')}</Link>
      </div>
    );
  };

  const renderLike = (s: SkillItem) => {
    const stat = stats[s.slug] ?? { likes: 0, installs: 0, liked: false };
    return (
      <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'var(--font-size-eyebrow)', color: stat.liked ? 'var(--error)' : 'var(--muted)' }} title={stat.liked ? t('unlike') : t('like')} onClick={() => toggleLike(s.slug)}>{stat.liked ? <Icon source="❤️" size="1em" /> : <Icon source="🤍" size="1em" />} {stat.likes}</button>
    );
  };

  // Marketplace skills are builtin/marketplace catalog rows — read-only (entity null): no
  // selection and no bulk bar. Search and filtering stay in this page.
  const descriptor: CollectionDescriptor<SkillItem> = {
    entity: null,
    surfaceKey: 'skills.marketplace',
    rowId: (s) => s.slug,
    label: (s) => s.name,
    defaultView: 'card',
    defaultSort: { key: 'name', dir: 'asc' },
    emptyKey: 'emptySkillsMarketplace',
    columns: [
      {
        key: 'name', header: t('colName'), sortKey: 'name',
        compare: (a, b) => a.name.localeCompare(b.name),
        cell: (s) => (<span style={{ fontWeight: 600 }}><Icon source={s.emoji ?? 'sparkles'} size={16} style={{ marginRight: 6 }} />{s.name}</span>),
      },
      { key: 'description', header: t('colDescription'), cell: (s) => s.description || '—' },
      {
        key: 'category', header: t('colCategory'), sortKey: 'category',
        compare: (a, b) => (a.category ?? '').localeCompare(b.category ?? ''),
        cell: (s) => (
          <>
            {s.category ? <span className="badge badge-gray" style={{ fontSize: 'var(--font-size-eyebrow)' }}>{s.category}</span> : '—'}
            {s.author && <div style={{ fontSize: 'var(--font-size-eyebrow)', marginTop: 2 }}>{t('byAuthor', { author: s.author })}</div>}
          </>
        ),
      },
      {
        key: 'stats', header: t('colStats'), sortKey: 'installs',
        compare: (a, b) => (stats[a.slug]?.installs ?? 0) - (stats[b.slug]?.installs ?? 0),
        cell: (s) => (
          <>
            {renderLike(s)}
            <span style={{ marginLeft: 10, fontSize: 'var(--font-size-eyebrow)' }}><Icon source="⬇️" size="1em" /> {stats[s.slug]?.installs ?? 0}</span>
          </>
        ),
      },
      { key: 'actions', header: t('colActions'), cell: renderActions },
    ],
    card: (s) => {
      const stat = stats[s.slug] ?? { likes: 0, installs: 0, liked: false };
      return (
        <div className="card" style={{ overflow: 'hidden', border: 'none' }}>
          {s.icon && <div style={{ width: '100%', height: 100, background: `url('${s.icon}') center/cover`, borderBottom: '1px solid var(--border)' }} />}
          <div style={{ padding: s.icon ? 12 : 0 }}>
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, background: 'var(--accent-subtle)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon source={s.emoji ?? 'sparkles'} size={18} /></div>
                <div>
                  <div className="card-title">{s.name}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {s.category && <span className="badge badge-gray" style={{ fontSize: 'var(--font-size-eyebrow)' }}>{s.category}</span>}
                  </div>
                </div>
              </div>
            </div>
            {s.description && <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--muted)', lineHeight: 1.5, margin: '8px 0' }}>{s.description}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 'var(--font-size-eyebrow)', color: 'var(--muted)', margin: '4px 0 8px' }}>
              {renderLike(s)}
              <span><Icon source="⬇️" size="1em" /> {stat.installs}</span>
              {s.author && <span>{t('byAuthor', { author: s.author })}</span>}
            </div>
            {renderActions(s)}
          </div>
        </div>
      );
    },
  };

  // `Collection` owns its sort/paging chrome, so the local source mirrors the same state
  // (same shape as components/pm/LocalCollection) and slices the page's filtered rows.
  const prefs = useCollectionPreferences(descriptor.surfaceKey, descriptor.defaultView ?? 'table');
  const paging = useCollectionPaging(prefs.pageSize);
  const sort = useCollectionSort(descriptor, paging.reset);
  const source = useLocalSource(marketplaceItems, descriptor, { key: sort.key, dir: sort.dir }, { page: paging.page, pageSize: paging.pageSize });

  return (
    <PageContainer width="readable">
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{t('title')}</h1>
          <p className="page-sub" style={{ fontSize: 'var(--font-size-small)', color: 'var(--muted)', margin: '4px 0 0' }}>{t('subtitle')}</p>
        </div>
        <WorkspaceSkillAuthor onCreated={() => { setWorkspaceView((v) => ({ status: 'approved', key: v.key + 1 })); setTab('workspace'); }} />
      </div>

      {error && <div style={{ marginBottom: 16, padding: '10px 14px', fontSize: 'var(--font-size-small)', background: 'var(--error-bg)', color: 'var(--error-text)', borderRadius: 'var(--radius-md)' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className={`btn ${tab === 'assigned' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('assigned')}>{t('tabAssigned', { n: assigned.length })}</button>
        <button type="button" className={`btn ${tab === 'marketplace' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('marketplace')}>{t('tabMarketplace', { n: marketplaceItems.length })}</button>
        {/* The workspace's OWN skills: written here, imported as Agent Skills folders,
            or proposed by its agents. A draft is inert until someone approves it, so
            this tab is also where that decision is made. */}
        <button type="button" className={`btn ${tab === 'workspace' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('workspace')}>{t('tabWorkspace')}</button>
      </div>

      {loading && tab === 'marketplace' ? (
        <div style={{ color: 'var(--muted)', fontSize: 'var(--font-size-small)' }}>{t('loading')}</div>
      ) : tab === 'assigned' ? (
        tenantNum ? (
          <SkillAssignmentsContent scope="tenant" scopeId={tenantNum} />
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon source="🔗" size="1em" /></div>
            <div className="empty-state-title">{t('noTenant')}</div>
          </div>
        )
      ) : tab === 'workspace' ? (
        <WorkspaceSkillReview key={workspaceView.key} initialStatus={workspaceView.status} />
      ) : (
        <>
          <CatalogInsightsBar entity="skills" items={insightsItems} primaryMetric="installs" secondaryMetric="likes" groupKind="category" />
          <Collection descriptor={descriptor} source={source} search={search} onSearchChange={(q) => { setSearch(q); paging.reset(); }} />
        </>
      )}

    </PageContainer>
  );
}
