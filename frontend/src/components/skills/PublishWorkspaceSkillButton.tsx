/**
 * "Publish to marketplace" for one of the workspace's approved skills — the whole
 * Agent Skills folder, so an installer receives exactly what this workspace runs.
 *
 * Replaces the old "Share to marketplace" toggle, which flipped a flag in this
 * browser's localStorage and published nothing. Self-contained: it reads the folder,
 * publishes it as the signed-in person, and reports the outcome itself.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { marketplacePublisherApi } from '@/lib/marketplaceSkillsApi';
import { ApiRequestError, faultMessage } from '@/lib/apiClient';
import { invalidateMarketplaceSkills } from '@/lib/marketplace/marketplaceReads';
import { useMarketplacePublisherToken } from '@/lib/marketplace/useMarketplacePublisherToken';
import { workspaceSkillsApi, type WorkspaceSkill } from '@/lib/workspaceSkillsApi';

const button: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: '7px 12px',
  minHeight: 34,
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  cursor: 'pointer',
};

export function PublishWorkspaceSkillButton({ skill }: { skill: Pick<WorkspaceSkill, 'id' | 'name' | 'status'> }) {
  const t = useTranslations('skillFolder');
  const signedIn = useMarketplacePublisherToken();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Only a binding skill is worth listing: a draft is not even in force here.
  if (skill.status !== 'approved' || !signedIn) return null;

  const publish = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const folder = await workspaceSkillsApi.exportFolder(skill.id);
      try {
        await marketplacePublisherApi.publishSkill({ name: skill.name, slug: folder.name, category: 'general', files: folder.files });
      } catch (e) {
        // Listed already (409): publishing again updates that listing's folder.
        if (!(e instanceof ApiRequestError && e.status === 409)) throw e;
        await marketplacePublisherApi.updateSkill(folder.name, { name: skill.name, files: folder.files });
      }
      invalidateMarketplaceSkills();
      setMessage({ ok: true, text: t('published') });
    } catch (e) {
      // null = signed out mid-publish; the session wall says so, not this button.
      const text = faultMessage(e, t('publishFailed'));
      setMessage(text ? { ok: false, text } : null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <button type="button" style={button} disabled={busy} onClick={() => void publish()}>{busy ? t('publishing') : t('publishToMarketplace')}</button>
      {message && (
        <span role={message.ok ? 'status' : 'alert'} style={{ fontSize: 'var(--font-size-eyebrow)', color: message.ok ? 'var(--success)' : 'var(--danger)' }}>{message.text}</span>
      )}
    </span>
  );
}
