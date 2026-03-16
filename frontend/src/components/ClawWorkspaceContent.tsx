'use client';

import { useState, useEffect } from 'react';
import { workspaceApi, type ClawDirectory, type ClawDirectoryFile } from '@/lib/builderforceApi';

interface ClawWorkspaceContentProps {
  clawId: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const STATUS_COLORS: Record<string, string> = {
  synced: 'var(--cyan-bright, #00e5cc)',
  pending: 'var(--text-muted)',
  error: 'var(--coral-bright, #f4726e)',
};

function FileIcon({ path }: { path: string }) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const icons: Record<string, string> = {
    ts: '𝘛𝘚', tsx: '⚛', js: 'JS', jsx: '⚛', json: '{}',
    md: '📝', css: '🎨', html: '🌐', py: '🐍', rs: 'RS',
    go: 'Go', sh: '⚙', yaml: '⚙', yml: '⚙', env: '🔐',
  };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        width: 24,
        flexShrink: 0,
        display: 'inline-block',
      }}
    >
      {icons[ext] ?? '📄'}
    </span>
  );
}

export function ClawWorkspaceContent({ clawId }: ClawWorkspaceContentProps) {
  const [directories, setDirectories] = useState<ClawDirectory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDir, setSelectedDir] = useState<ClawDirectory | null>(null);
  const [files, setFiles] = useState<ClawDirectoryFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    workspaceApi
      .listDirectories(clawId)
      .then(setDirectories)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clawId]);

  const openDir = async (dir: ClawDirectory) => {
    setSelectedDir(dir);
    setFiles([]);
    setLoadingFiles(true);
    try {
      const f = await workspaceApi.listFiles(clawId, dir.id);
      setFiles(f);
    } catch {
      // ignore
    } finally {
      setLoadingFiles(false);
    }
  };

  const triggerSync = async (dir: ClawDirectory, e: React.MouseEvent) => {
    e.stopPropagation();
    setSyncing(dir.id);
    try {
      await workspaceApi.triggerSync(clawId, dir.id);
      // refresh directories after sync
      const updated = await workspaceApi.listDirectories(clawId);
      setDirectories(updated);
    } catch {
      // ignore
    } finally {
      setSyncing(null);
    }
  };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading workspace…</div>;
  if (error) return <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>Error: {error}</div>;

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
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            ← Back
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
            <div style={{ fontSize: 11, color: STATUS_COLORS[selectedDir.status], marginTop: 2 }}>
              {selectedDir.status}
              {selectedDir.lastSyncedAt
                ? ` · synced ${new Date(selectedDir.lastSyncedAt).toLocaleString()}`
                : ''}
            </div>
          </div>
        </div>

        {loadingFiles ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading files…</div>
        ) : files.length === 0 ? (
          <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
            No files synced yet.
          </div>
        ) : (
          <div style={cardStyle}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>{files.length} files</div>
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
                  <FileIcon path={file.relPath} />
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
                    {file.sizeBytes < 1024
                      ? `${file.sizeBytes}B`
                      : `${(file.sizeBytes / 1024).toFixed(1)}KB`}
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
        Synced Directories ({directories.length})
      </div>
      {directories.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          No directories synced. Directories are synced when a claw registers its workspace.
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
                  Last synced: {new Date(dir.lastSyncedAt).toLocaleString()}
                </div>
              )}
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '3px 8px',
                borderRadius: 6,
                background: 'var(--bg-elevated)',
                color: STATUS_COLORS[dir.status] ?? 'var(--text-muted)',
                flexShrink: 0,
              }}
            >
              {dir.status}
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
                borderRadius: 6,
                cursor: syncing === dir.id ? 'wait' : 'pointer',
                flexShrink: 0,
              }}
            >
              {syncing === dir.id ? '…' : '⟳ Sync'}
            </button>
          </button>
        ))
      )}
    </div>
  );
}
