'use client';

import { Icon } from '@/components/ui/Icon';
import { slugify } from '@builderforce/creation-canvas-contract';
import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { useAuth } from '@/lib/AuthContext';
import {
  artifactAssignments,
  marketplaceStats,
  agentHosts,
  personasApi,
  type ArtifactAssignment,
  type ArtifactStats,
  type PublicPersona,
} from '@/lib/builderforceApi';
import { BUILTIN_PERSONAS, type Persona, type UserPersona } from '@/lib/marketplaceData';
import { MyPersonasList, MarketplaceList } from './PersonasLists';
import { CatalogInsightsBar, type CatalogInsightsItem } from '@/components/CatalogInsightsBar';
import PsychometricEditor from '@/components/PsychometricEditor';
import type { PsychometricProfile } from '@/lib/psychometric';
import PageContainer from '@/components/PageContainer';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { PersonaAssignmentsContent } from '@/components/PersonaAssignmentsContent';
import { faultText } from '@/lib/apiClient';
import { useErrorText } from '@/i18n/useErrorMessage';
/** Map a server-owned persona (from GET /api/personas/mine) into the flat display
 *  shape the "My Personas" tab renders. `shared` = the persona is published (public). */
function serverToUserPersona(p: PublicPersona): UserPersona {
  const b = p.persona ?? {};
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description ?? '',
    voice: b.voice ?? '',
    perspective: b.perspective ?? '',
    decisionStyle: b.decisionStyle ?? '',
    outputPrefix: b.outputPrefix ?? '',
    capabilities: b.capabilities ?? [],
    tags: p.tags ?? [],
    shared: p.visibility === 'public',
    image: b.image,
    likes: p.likeCount ?? 0,
    downloads: p.installCount ?? 0,
    createdAt: p.updatedAt ?? new Date().toISOString(),
    psychometric: p.psychometric ?? undefined,
  };
}

/** Map a server-published persona into the marketplace display shape (`Persona`).
 *  The behaviour fields live NESTED under `persona` (server contract), not flat. */
function publicToPersona(p: PublicPersona): Persona {
  const b = p.persona ?? {};
  return {
    name: p.slug || p.name,
    description: p.description ?? '',
    voice: b.voice || '—',
    perspective: b.perspective || '—',
    decisionStyle: b.decisionStyle || '—',
    outputPrefix: b.outputPrefix ?? '',
    capabilities: b.capabilities ?? [],
    source: 'user-global',
    tags: p.tags ?? [],
    author: p.authorName ?? 'Community',
    image: b.image,
    likes: p.likeCount,
    downloads: p.installCount,
    psychometric: p.psychometric ?? undefined,
  };
}

export default function PersonasPage() {
  const t = useTranslations('personasPage');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const confirm = useConfirm();
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? '';
  const tenantNum = Number(tenantId);

  const [tab, setTab] = useState<'assigned' | 'marketplace' | 'my-personas'>('assigned');
  const [search, setSearch] = useState('');
  const [mineSearch, setMineSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assigned, setAssigned] = useState<ArtifactAssignment[]>([]);
  const [userPersonas, setUserPersonas] = useState<UserPersona[]>([]);
  // Public personas from the server registry (GET /api/personas/public). Empty on
  // an older backend; the builtins are always shown so the tab is never blank.
  const [publicPersonas, setPublicPersonas] = useState<Persona[]>([]);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, ArtifactStats>>({});
  const [hasAgentHosts, setHasAgentHosts] = useState(true);
  const [installedSlugs, setInstalledSlugs] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [createPsychometric, setCreatePsychometric] = useState<PsychometricProfile | undefined>(undefined);
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    voice: '',
    perspective: '',
    decisionStyle: '',
    outputPrefix: '',
    capabilities: '',
    tags: '',
    image: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [all, agentHostList, pub, mine] = await Promise.all([
        tenantNum ? artifactAssignments.list('tenant', tenantNum, 'persona').catch(() => []) : [],
        agentHosts.list().catch(() => []),
        // Public registry is best-effort: [] on 404/older backend so builtins still render.
        personasApi.listPublic().catch(() => [] as PublicPersona[]),
        // My Personas are server-backed (private marketplace_personas rows) — durable +
        // cross-device, and they reach execution via the same capability path.
        personasApi.listMine().catch(() => [] as PublicPersona[]),
      ]);
      setAssigned(all);
      setUserPersonas(mine.map(serverToUserPersona));
      setHasAgentHosts(agentHostList.length > 0);
      setInstalledSlugs(new Set(all.map((a) => a.artifactSlug)));
      // Server personas first, then builtins not already present (dedup by slug/name).
      const serverPersonas = pub.map(publicToPersona);
      const serverSlugs = new Set(serverPersonas.map((p) => p.name));
      setPublicPersonas(serverPersonas);
      const slugs = [...serverSlugs, ...BUILTIN_PERSONAS.map((p) => p.name).filter((n) => !serverSlugs.has(n))];
      if (slugs.length > 0) {
        const s = await marketplaceStats.getStats('persona', slugs).catch(() => ({}));
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
  }, [tenantId, load]);

  const assignPersona = async (slug: string) => {
    if (!tenantNum) return;
    try {
      await artifactAssignments.assign('persona', slug, 'tenant', tenantNum);
      setInstalledSlugs((prev) => new Set([...prev, slug]));
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const unassignPersona = async (slug: string) => {
    if (!tenantNum) return;
    try {
      await artifactAssignments.unassign('persona', slug, 'tenant', tenantNum);
      setInstalledSlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
      setAssigned((prev) => prev.filter((a) => a.artifactSlug !== slug));
      const updated = await marketplaceStats.getStats('persona', [slug]).catch(() => ({}));
      setStats((s) => ({ ...s, ...updated }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const toggleLike = async (slug: string) => {
    try {
      const liked = await marketplaceStats.toggleLike('persona', slug);
      const prev = stats[slug] ?? { likes: 0, installs: 0, liked: false };
      setStats((s) => ({
        ...s,
        [slug]: { ...prev, liked, likes: liked ? prev.likes + 1 : Math.max(0, prev.likes - 1) },
      }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const savePersona = async () => {
    const name = createForm.name.trim();
    if (!name) return;
    const slug = slugify(name, { maxLength: 80 });
    setError('');
    try {
      await personasApi.create({
        name,
        description: createForm.description.trim() || undefined,
        tags: createForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
        persona: {
          voice: createForm.voice.trim() || 'neutral and helpful',
          perspective: createForm.perspective.trim() || 'balanced and pragmatic',
          decisionStyle: createForm.decisionStyle.trim() || 'collaborative',
          outputPrefix: createForm.outputPrefix.trim() || `${slug.toUpperCase()}:`,
          capabilities: createForm.capabilities.split(',').map((c) => c.trim()).filter(Boolean),
          image: createForm.image.trim() || undefined,
        },
        psychometric: createPsychometric,
      });
      setCreateOpen(false);
      setCreateForm({ name: '', description: '', voice: '', perspective: '', decisionStyle: '', outputPrefix: '', capabilities: '', tags: '', image: '' });
      setCreatePsychometric(undefined);
      setTab('my-personas');
      await load();
    } catch (e) {
      setError(faultText(e, t('createFailed')));
    }
  };

  const deleteUserPersona = async (id: string) => {
    if (!(await confirm(t('confirmDelete')))) return;
    setError('');
    try {
      await personasApi.remove(id);
      setUserPersonas((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(faultText(e, t('deleteFailed')));
    }
  };

  /** Publish a local draft persona to the public server registry (POST /api/personas),
   *  then refresh so it appears in the Marketplace tab. Also flips the local `shared`
   *  flag so the draft layer reflects the published state. Degrades gracefully:
   *  errors surface in the page banner and leave the draft intact. */
  const publishPersona = async (p: UserPersona) => {
    setPublishingId(p.id);
    setError('');
    try {
      // My Personas are already server rows — publishing just flips visibility to
      // public (PATCH), rather than creating a duplicate.
      await personasApi.update(p.id, { visibility: 'public' });
      setUserPersonas((prev) => prev.map((u) => (u.id === p.id ? { ...u, shared: true } : u)));
      await load();
    } catch (e) {
      setError(faultText(e, t('publishFailed')));
    } finally {
      setPublishingId(null);
    }
  };

  // Marketplace listing = server registry personas + builtins not already published.
  const serverSlugs = new Set(publicPersonas.map((p) => p.name));
  const marketplacePersonas: Persona[] = [
    ...publicPersonas,
    ...BUILTIN_PERSONAS.filter((p) => !serverSlugs.has(p.name)),
  ];

  const insightsItems: CatalogInsightsItem[] = marketplacePersonas.map((p) => {
    const stat = stats[p.name] ?? { likes: 0, installs: 0, liked: false };
    return { key: p.name, name: p.name, group: p.source ?? null, primary: stat.installs, secondary: stat.likes };
  });

  return (
    <PageContainer width="readable">
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{t('title')}</h1>
          <p className="page-sub" style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
            {t('subtitle')}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          {t('newPersona')}
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: '10px 14px', fontSize: 13, background: 'var(--error-bg)', color: 'var(--error-text)', borderRadius: 'var(--radius-md)' }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, alignItems: 'center' }}>
        <button type="button" className={`btn ${tab === 'assigned' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('assigned')}>
          {t('tabAssigned', { n: assigned.length })}
        </button>
        <button type="button" className={`btn ${tab === 'marketplace' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('marketplace')}>
          {t('tabMarketplace', { n: marketplacePersonas.length })}
        </button>
        <button type="button" className={`btn ${tab === 'my-personas' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('my-personas')}>
          {t('tabMyPersonas', { n: userPersonas.length })}
        </button>
      </div>

      {loading && tab !== 'assigned' ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('loading')}</div>
      ) : tab === 'assigned' ? (
        tenantNum ? (
          <PersonaAssignmentsContent scope="tenant" scopeId={tenantNum} />
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon source="🔗" size="1em" /></div>
            <div className="empty-state-title">{t('noTenant')}</div>
          </div>
        )
      ) : tab === 'my-personas' ? (
        userPersonas.length === 0 && !mineSearch ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon source="🎭" size="1em" /></div>
            <div className="empty-state-title">{t('noCustomTitle')}</div>
            <div className="empty-state-sub">{t('noCustomSub')}</div>
            <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setCreateOpen(true)}>{t('newPersonaShort')}</button>
          </div>
        ) : (
          <MyPersonasList
            personas={userPersonas}
            search={mineSearch}
            onSearchChange={setMineSearch}
            publishingId={publishingId}
            onPublish={publishPersona}
            onDelete={deleteUserPersona}
            onReload={load}
          />
        )
      ) : (
        <>
          <CatalogInsightsBar entity="personas" items={insightsItems} primaryMetric="installs" secondaryMetric="likes" groupKind="source" />
          <MarketplaceList
            personas={marketplacePersonas}
            search={search}
            onSearchChange={setSearch}
            stats={stats}
            installedSlugs={installedSlugs}
            expanded={expanded}
            onExpand={setExpanded}
            onInstall={assignPersona}
            onUninstall={unassignPersona}
            onToggleLike={toggleLike}
          />
        </>
      )}

      <SlideOutPanel open={createOpen} onClose={() => setCreateOpen(false)} title={t('newPersonaShort')} width="sheet" widthStorageKey="personas-new">
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="label">{t('formName')}</label>
                <input className="input" placeholder={t('formNamePlaceholder')} value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('formDescription')}</label>
                <textarea className="input" rows={2} placeholder={t('formDescPlaceholder')} value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="label">{t('formVoice')}</label>
                  <input className="input" placeholder={t('formVoicePlaceholder')} value={createForm.voice} onChange={(e) => setCreateForm((f) => ({ ...f, voice: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">{t('formOutputPrefix')}</label>
                  <input className="input" placeholder={t('formOutputPrefixPlaceholder')} value={createForm.outputPrefix} onChange={(e) => setCreateForm((f) => ({ ...f, outputPrefix: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">{t('formPerspective')}</label>
                <input className="input" placeholder={t('formPerspectivePlaceholder')} value={createForm.perspective} onChange={(e) => setCreateForm((f) => ({ ...f, perspective: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('formDecisionStyle')}</label>
                <input className="input" placeholder={t('formDecisionStylePlaceholder')} value={createForm.decisionStyle} onChange={(e) => setCreateForm((f) => ({ ...f, decisionStyle: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('formCapabilities')}</label>
                <input className="input" placeholder={t('formCapabilitiesPlaceholder')} value={createForm.capabilities} onChange={(e) => setCreateForm((f) => ({ ...f, capabilities: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('formTags')}</label>
                <input className="input" placeholder={t('formTagsPlaceholder')} value={createForm.tags} onChange={(e) => setCreateForm((f) => ({ ...f, tags: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('formCoverImage')}</label>
                <input className="input" placeholder="https://example.com/image.jpg" value={createForm.image} onChange={(e) => setCreateForm((f) => ({ ...f, image: e.target.value }))} />
              </div>
              <PsychometricEditor value={createPsychometric} onChange={setCreatePsychometric} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>{t('cancel')}</button>
                <button type="button" className="btn btn-primary" onClick={savePersona} disabled={!createForm.name.trim()}>{t('savePersona')}</button>
              </div>
        </div>
      </SlideOutPanel>
    </PageContainer>
  );
}
