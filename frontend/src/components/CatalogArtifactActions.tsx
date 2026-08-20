'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import ArtifactAssigner from '@/components/ArtifactAssigner';
import { useAuth } from '@/lib/AuthContext';
import { agentHosts, artifactAssignments, marketplaceStats, type ArtifactType } from '@/lib/builderforceApi';

/**
 * The interactive half of a catalog detail page — likes, install/uninstall and
 * the assignment panel — for a skill or a persona.
 *
 * ONE island, not one per entity. `/skills/[slug]` and `/personas/[slug]` ran
 * byte-identical copies of this logic: the same three-way parallel load, the
 * same optimistic counter arithmetic, the same "register an agent host first"
 * disabled state. The only thing that ever differed was the `ArtifactType`
 * string, which is now a prop.
 *
 * Both pages around it are Server Components, so everything a crawler or a first
 * paint needs is already in the HTML; what is left here is only what genuinely
 * needs a session and a browser. Those routes also became publicly viewable in
 * the same change, so the controls are GATED on a session rather than rendered
 * and left to fail — a signed-out visitor gets the counters and a sign-up call
 * to action, not an Install button that 401s.
 */
export default function CatalogArtifactActions({
  artifactType, slug, name,
}: {
  artifactType: Extract<ArtifactType, 'skill' | 'persona'>;
  /** The artifact key: a skill's slug, a persona's (slug-shaped) name. */
  slug: string;
  name: string;
}) {
  const t = useTranslations('catalogActions');
  const { tenant, isAuthenticated, authReady } = useAuth();
  const tenantNum = Number(tenant?.id ?? 0);

  const [stats, setStats] = useState<{ likes: number; installs: number; liked: boolean } | null>(null);
  const [installed, setInstalled] = useState(false);
  const [hasAgentHosts, setHasAgentHosts] = useState(false);

  useEffect(() => {
    // `authReady` gates the load: `isAuthenticated` is unavoidably false until
    // the stored session has been read off the device, so acting earlier would
    // show a signed-in visitor the signed-out controls for a frame.
    if (!authReady) return;
    let cancelled = false;
    (async () => {
      const [agentHostList, assignList, s] = await Promise.all([
        isAuthenticated ? agentHosts.list().catch(() => []) : Promise.resolve([]),
        isAuthenticated && tenantNum
          ? artifactAssignments.list('tenant', tenantNum, artifactType).catch(() => [])
          : Promise.resolve([]),
        marketplaceStats
          .getStats(artifactType, [slug])
          .then((r) => r[slug] ?? { likes: 0, installs: 0, liked: false })
          .catch(() => ({ likes: 0, installs: 0, liked: false })),
      ]);
      if (cancelled) return;
      setHasAgentHosts(agentHostList.length > 0);
      setInstalled(assignList.some((a) => a.artifactSlug === slug));
      setStats(s);
    })();
    return () => { cancelled = true; };
  }, [artifactType, slug, tenantNum, isAuthenticated, authReady]);

  const toggleLike = async () => {
    if (!stats) return;
    try {
      const liked = await marketplaceStats.toggleLike(artifactType, slug);
      setStats((prev) => (prev
        ? { ...prev, liked, likes: liked ? prev.likes + 1 : Math.max(0, prev.likes - 1) }
        : null));
    } catch { /* a like that does not land is not worth an error dialog */ }
  };

  const toggleInstall = async () => {
    if (!tenantNum) return;
    try {
      if (installed) {
        await artifactAssignments.unassign(artifactType, slug, 'tenant', tenantNum);
        setInstalled(false);
        setStats((prev) => (prev ? { ...prev, installs: Math.max(0, prev.installs - 1) } : null));
      } else {
        await artifactAssignments.assign(artifactType, slug, 'tenant', tenantNum);
        setInstalled(true);
        setStats((prev) => (prev ? { ...prev, installs: prev.installs + 1 } : null));
      }
    } catch { /* ignore — the button reflects server state on the next load */ }
  };

  return (
    <>
      <button
        type="button"
        className="pdl-btn pdl-btn-ghost"
        onClick={toggleLike}
        disabled={!isAuthenticated}
        style={{ color: stats?.liked ? 'var(--error)' : 'var(--text-primary)' }}
      >
        <Icon source={stats?.liked ? '❤️' : '🤍'} size="1em" />
        {t('likes', { count: stats?.likes ?? 0 })}
      </button>

      <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        {t('installs', { count: stats?.installs ?? 0 })}
      </span>

      {isAuthenticated ? (
        <>
          <ArtifactAssigner artifactType={artifactType} artifactSlug={slug} artifactName={name} />
          <button
            type="button"
            className={`pdl-btn ${installed ? 'pdl-btn-ghost' : 'pdl-btn-primary'}`}
            disabled={!hasAgentHosts}
            onClick={toggleInstall}
          >
            {!hasAgentHosts ? t('registerHostFirst') : installed ? t('uninstall') : t('install')}
          </button>
        </>
      ) : (
        <Link className="pdl-btn pdl-btn-primary" href="/register">{t('signUpToInstall')}</Link>
      )}
    </>
  );
}
