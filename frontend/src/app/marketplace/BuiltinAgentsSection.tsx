/**
 * The marketplace's Agents ▸ Built-in chip — the roster every workspace receives.
 *
 * Built-in agents are provisioned per workspace with `published: false`, so the
 * public registry (`GET /api/workforce/agents`) can never return them, and the
 * chip that filtered that registry for `builtin_kind` was empty for every
 * visitor. This section reads the roster itself (`/api/workforce/builtin-agents`)
 * and offers what is actually true of it: nothing to hire — it is already in
 * your workspace.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { signInHref } from '@/lib/auth';
import { SkillTags } from '@/components/SkillTags';
import { marketplaceReads } from '@/lib/marketplace/marketplaceReads';
import type { BuiltinAgentEntry } from '@/lib/types';
import { SkeletonGrid } from './SkeletonGrid';

const WORKFORCE_HREF = '/workforce';

function matches(agent: BuiltinAgentEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [agent.name, agent.title, ...agent.skills].some((field) => field.toLowerCase().includes(needle));
}

export function BuiltinAgentsSection({ search, limit }: { search: string; limit?: number }) {
  const t = useTranslations('marketplace.builtinAgents');
  const { isAuthenticated } = useAuth();
  const [roster, setRoster] = useState<BuiltinAgentEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    marketplaceReads.builtinAgents()
      .then((list) => { if (!cancelled) setRoster(list); })
      .catch(() => { if (!cancelled) { setFailed(true); setRoster([]); } });
    return () => { cancelled = true; };
  }, []);

  const shown = (roster ?? []).filter((a) => matches(a, search.trim())).slice(0, limit);
  const href = isAuthenticated ? WORKFORCE_HREF : signInHref(WORKFORCE_HREF);

  if (roster === null) return <SkeletonGrid count={limit ?? 6} />;
  if (failed) return <p role="alert" className="mp-builtin__empty">{t('error')}</p>;
  if (shown.length === 0) return <p className="mp-builtin__empty">{t('empty')}</p>;

  return (
    <div className="mp-builtin">
      {shown.map((agent) => (
        <article key={agent.kind} className="mp-builtin__card">
          <header className="mp-builtin__head">
            <strong className="mp-builtin__name">{agent.name}</strong>
            <span className="mp-builtin__badge">{t('included')}</span>
          </header>
          <p className="mp-builtin__title">{agent.title}</p>
          <p className="mp-builtin__bio">{agent.bio}</p>
          <SkillTags skills={agent.skills} max={4} />
          <Link href={href} className="mp-builtin__action">
            {isAuthenticated ? t('open') : t('signIn')} →
          </Link>
        </article>
      ))}
    </div>
  );
}
