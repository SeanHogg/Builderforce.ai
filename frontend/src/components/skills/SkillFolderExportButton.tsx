'use client';

/**
 * "Download folder" — any skill this person can see, as a spec Agent Skills folder
 * (`<name>.zip` containing `<name>/SKILL.md` and its bundled files), ready to drop into
 * Claude Code's `.claude/skills`, a repo's `.agents/skills`, or any other agent that
 * reads the standard.
 *
 * One button for both stores: a workspace skill (by id, member-level) and a published
 * marketplace skill (by slug, public). The fetch, the zip and the failure all live
 * here, so a host only says which skill.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { workspaceSkillsApi } from '@/lib/workspaceSkillsApi';
import { marketplacePublisherApi } from '@/lib/marketplaceSkillsApi';
import { downloadSkillFolder } from '@/lib/skillFolderFiles';
import { useErrorMessage } from '@/i18n/useErrorMessage';

export type SkillFolderSource = { kind: 'workspace'; id: string } | { kind: 'marketplace'; slug: string };

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

export function SkillFolderExportButton({ source, style }: { source: SkillFolderSource; style?: React.CSSProperties }) {
  const t = useTranslations('skillFolder');
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const folder = source.kind === 'workspace'
        ? await workspaceSkillsApi.exportFolder(source.id)
        : await marketplacePublisherApi.exportSkill(source.slug);
      downloadSkillFolder(folder.name, folder.files);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <button type="button" style={{ ...button, ...style }} disabled={busy} onClick={() => void run()}>
        {busy ? t('exporting') : t('export')}
      </button>
      {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--font-size-eyebrow)' }}>{error}</span>}
    </span>
  );
}
