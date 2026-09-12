'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { workspaceApi, type AgentHostDirectory, type AgentHostDirectoryFile } from '@/lib/builderforceApi';
import { useFormat } from "@/i18n/useFormat";
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { formatBytes } from '@/lib/formatBytes';
import { Icon, type IconName } from '@/components/ui/Icon';
import { statusColor, type StatusToneMap } from '@/lib/statusTone';

interface AgentHostWorkspaceContentProps {
  agentHostId: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

const STATUS_TONE: StatusToneMap<AgentHostDirectory['status']> = {
  synced: 'info',
  pending: 'neutral',
  error: 'danger',
};

/** A file row's glyph, picked by extension: source → code, prose → edit, styles →
 *  image, markup → workspace, config → settings, secrets → lock, anything else →
 *  document. Rendered through the shared icon set, never an OS emoji. */
const FILE_ICON_BY_EXT: Record<string, IconName> = {
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', json: 'code', py: 'code', rs: 'code', go: 'code',
  md: 'edit', css: 'image', html: 'workspace',
  sh: 'settings', yaml: 'settings', yml: 'settings', env: 'lock',
};

function fileIconName(path: string): IconName {
  return FILE_ICON_BY_EXT[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'document';
}

const fileIconStyle: React.CSSProperties = { color: 'var(--text-muted)', width: 24, flexShrink: 0 };

export function AgentHostWorkspaceContent({ agentHostId }: AgentHostWorkspaceContentProps) {
  const fmt = useFormat();
  const tc = useTranslations('common');
  const t = useTranslations('agentHostTabs');
  const errorMessage = useErrorMessage();
  const [directories, setDirectories] = useState<AgentHostDirectory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDir, setSelectedDir] = useState<AgentHostDirectory | null>(null);
  const [files, setFiles] = useState<AgentHostDirectoryFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    workspaceApi
      .listDirectories(agentHostId)
      .then(setDirectories)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [agentHostId, errorMessage]);

  const openDir = async (dir: AgentHostDirectory) => {
    setSelectedDir(dir);
    setFiles([]);
    setLoadingFiles(true);
    try {
      const f = await workspaceApi.listFiles(agentHostId, dir.id);
      setFiles(f);
    } catch {
      // ignore
    } finally {
      setLoadingFiles(false);
    }
  };

  const triggerSync = async (dir: AgentHostDirectory, e: React.MouseEvent) => {
    e.stopPropagation();
    setSyncing(dir.id);
    try {
      await workspaceApi.triggerSync(agentHostId, dir.id);
      // refresh directories after sync
      const updated = await workspaceApi.listDirectories(agentHostId);
      setDirectories(updated);
    } catch {
      // ignore
    } finally {
      setSyncing(null);
    }
  };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tc('loading')}</div>;
  if (error) return <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>{t('errorPrefix', { message: error })}</div>;

  if (selectedDir) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => { setSelectedDir(null); setFiles([]); }}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--bg-base)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            {t('back')}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {selectedDir.absPath}
            </div>
            <div style={{ fontSize: 11, color: statusColor(STATUS_TONE, selectedDir.status), marginTop: 2 }}>
              {t('workspace.status', { status: selectedDir.status })}
              {selectedDir.lastSyncedAt
                ? ` · ${t('workspace.syncedAt', { when: fmt.dateTime(selectedDir.lastSyncedAt) })}`
                : ''}
            </div>
          </div>
        </div>

        {loadingFiles ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tc('loading')}</div>
        ) : files.length === 0 ? (
          <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
            {t('workspace.noFiles')}
          </div>
        ) : (
          <div style={cardStyle}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>{t('workspace.fileCount', { count: files.length })}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {files.map((file) => (
                <div
                  key={file.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 0',
                    borderBottom: '1px solid var(--border-subtle)',
                    fontSize: 12,
                  }}
                >
                  <Icon name={fileIconName(file.relPath)} size={14} style={fileIconStyle} />
                  <span
                    style={{
                      flex: 1,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {file.relPath}
                  </span>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                    {formatBytes(file.sizeBytes)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
        {t('workspace.heading', { count: directories.length })}
      </div>
      {directories.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          {t('workspace.empty')}
        </div>
      ) : (
        directories.map((dir) => (
          <button
            key={dir.id}
            type="button"
            onClick={() => openDir(dir)}
            style={{
              ...cardStyle,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {dir.absPath}
              </div>
              {dir.lastSyncedAt && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  {t('workspace.lastSynced', { when: fmt.dateTime(dir.lastSyncedAt) })}
                </div>
              )}
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
                color: statusColor(STATUS_TONE, dir.status),
                flexShrink: 0,
              }}
            >
              {t('workspace.status', { status: dir.status })}
            </span>
            <button
              type="button"
              onClick={(e) => triggerSync(dir, e)}
              disabled={syncing === dir.id}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                cursor: syncing === dir.id ? 'wait' : 'pointer',
                flexShrink: 0,
              }}
            >
              {syncing === dir.id ? '…' : t('workspace.sync')}
            </button>
          </button>
        ))
      )}
    </div>
  );
}
