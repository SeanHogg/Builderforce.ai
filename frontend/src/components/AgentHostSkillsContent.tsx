import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  artifactAssignments,
  listMarketplaceSkills,
  type ArtifactAssignment,
  type MarketplaceSkill,
} from '@/lib/builderforceApi';
import { useErrorMessage } from '@/i18n/useErrorMessage';

interface AgentHostSkillsContentProps {
  agentHostId: number;
  tenantId?: number | null;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

const small: React.CSSProperties = { fontSize: 'var(--font-size-small)' };
const eyebrow: React.CSSProperties = { fontSize: 'var(--font-size-eyebrow)' };

/**
 * The skills a self-hosted agent loads: the workspace-wide grants plus the ones given to
 * this host. Both live in the ONE assignment store (`artifact_assignments`) that runs,
 * the skill catalog and the host's skill sync read, so a grant made here reaches the
 * host's next run.
 */
export function AgentHostSkillsContent({ agentHostId, tenantId }: AgentHostSkillsContentProps) {
  const t = useTranslations('agentHostSkills');
  const errorMessage = useErrorMessage();
  const [tenantRows, setTenantRows] = useState<ArtifactAssignment[]>([]);
  const [hostRows, setHostRows] = useState<ArtifactAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      tenantId ? artifactAssignments.list('tenant', tenantId, 'skill') : Promise.resolve([]),
      artifactAssignments.list('host', agentHostId, 'skill'),
    ])
      .then(([tenant, host]) => { setTenantRows(tenant); setHostRows(host); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [agentHostId, tenantId, errorMessage]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!showAdd) return;
    listMarketplaceSkills({ q: searchQ || undefined, limit: 30 })
      .then((r) => setMarketplaceSkills(r.skills))
      .catch(() => setMarketplaceSkills([]));
  }, [showAdd, searchQ]);

  const run = async (slug: string, act: () => Promise<unknown>) => {
    setBusy(slug);
    setError(null);
    try {
      await act();
      load();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const assigned = new Set([...tenantRows, ...hostRows].map((a) => a.artifactSlug));
  const total = assigned.size;

  if (loading) return <div style={{ ...small, color: 'var(--text-muted)' }}>{t('loading')}</div>;

  const row = (a: ArtifactAssignment, badge: string, revocable: boolean) => (
    <div key={`${a.scope}:${a.artifactSlug}`} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 160px', minWidth: 0, ...small, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
        {a.artifactSlug}
      </div>
      <span style={{ ...eyebrow, fontWeight: 700, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
        {badge}
      </span>
      {revocable && (
        <button
          type="button"
          onClick={() => void run(a.artifactSlug, () => artifactAssignments.unassign('skill', a.artifactSlug, 'host', agentHostId))}
          disabled={busy === a.artifactSlug}
          style={{ ...eyebrow, padding: '6px 10px', fontWeight: 600, background: 'none', color: 'var(--coral-bright)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', cursor: busy === a.artifactSlug ? 'wait' : 'pointer' }}
        >
          {busy === a.artifactSlug ? '…' : t('revoke')}
        </button>
      )}
    </div>
  );

  const heading = (text: string) => (
    <div style={{ ...eyebrow, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{text}</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ ...small, fontWeight: 600, color: 'var(--text-primary)' }}>{t('heading', { count: total })}</div>
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          style={{ ...small, padding: '6px 12px', fontWeight: 600, background: showAdd ? 'var(--bg-base)' : 'var(--surface-interactive)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
        >
          {showAdd ? t('cancel') : t('add')}
        </button>
      </div>

      {error && <div style={{ ...cardStyle, ...small, color: 'var(--coral-bright)' }}>{error}</div>}

      {showAdd && (
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...small, fontWeight: 600, color: 'var(--text-primary)' }}>{t('addFromMarketplace')}</div>
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            style={{ ...small, padding: '8px 12px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
            {marketplaceSkills.length === 0 && (
              <div style={{ ...eyebrow, color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>{t('noResults')}</div>
            )}
            {marketplaceSkills.map((skill) => {
              const already = assigned.has(skill.slug);
              return (
                <div key={skill.slug} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', opacity: already ? 0.6 : 1 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...small, fontWeight: 600, color: 'var(--text-primary)' }}>{skill.name}</div>
                    <div style={{ ...eyebrow, color: 'var(--text-muted)', marginTop: 1, wordBreak: 'break-all' }}>
                      {skill.slug}
                      {skill.category ? ` · ${skill.category}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={already || busy === skill.slug}
                    onClick={() => void run(skill.slug, () => artifactAssignments.assign('skill', skill.slug, 'host', agentHostId))}
                    style={{ ...eyebrow, padding: '6px 10px', fontWeight: 600, background: already ? 'var(--bg-elevated)' : 'var(--coral-bright)', color: already ? 'var(--text-muted)' : 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: already || busy === skill.slug ? 'not-allowed' : 'pointer' }}
                  >
                    {busy === skill.slug ? '…' : already ? t('added') : t('addOne')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tenantRows.length > 0 && (
        <>
          {heading(t('tenantWide'))}
          {tenantRows.map((a) => row(a, t('badgeTenant'), false))}
        </>
      )}

      {hostRows.length > 0 && (
        <>
          {heading(t('hostSpecific'))}
          {hostRows.map((a) => row(a, t('badgeHost'), true))}
        </>
      )}

      {total === 0 && !showAdd && (
        <div style={{ ...cardStyle, ...small, color: 'var(--text-muted)', textAlign: 'center' }}>{t('empty')}</div>
      )}
    </div>
  );
}
