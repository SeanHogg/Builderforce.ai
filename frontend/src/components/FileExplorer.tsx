'use client';

import { useState } from 'react';
import { buildTree } from '@/lib/utils';
import type { TreeNode } from '@/lib/utils';
import type { FileEntry } from '@/lib/types';

interface FileExplorerProps {
  files: FileEntry[];
  activeFile?: string;
  onFileSelect: (path: string) => void;
  onFileCreate: (path: string) => void;
  onFileDelete: (path: string) => void;
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const icons: Record<string, string> = {
    ts: '🔷', tsx: '⚛️', js: '🟨', jsx: '⚛️',
    css: '🎨', html: '🌐', json: '📋', md: '📝',
    py: '🐍', sh: '⚙️', env: '🔒',
  };
  return icons[ext || ''] || '📄';
}

function TreeNodeComponent({
  node, activeFile, onFileSelect, onFileDelete, depth = 0,
}: {
  node: TreeNode; activeFile?: string;
  onFileSelect: (path: string) => void;
  onFileDelete: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const indent = depth * 14 + 10;

  if (node.type === 'directory') {
    return (
      <div>
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            paddingLeft: indent, paddingTop: 3, paddingBottom: 3, paddingRight: 8,
            cursor: 'pointer', fontSize: '0.8rem', userSelect: 'none',
            background: hovered ? 'var(--bg-elevated)' : 'transparent',
            color: 'var(--text-secondary)',
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', width: 10, flexShrink: 0 }}>{expanded ? '▼' : '▶'}</span>
          <span>📁</span>
          <span style={{ fontWeight: 600, fontFamily: 'var(--font-display)', fontSize: '0.78rem' }}>{node.name}</span>
        </div>
        {expanded && node.children?.map(child => (
          <TreeNodeComponent
            key={child.path}
            node={child}
            activeFile={activeFile}
            onFileSelect={onFileSelect}
            onFileDelete={onFileDelete}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  const isActive = activeFile === node.path;
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingLeft: indent, paddingTop: 3, paddingBottom: 3, paddingRight: 6,
        cursor: 'pointer', fontSize: '0.8rem',
        background: isActive ? 'var(--surface-coral-soft)' : hovered ? 'var(--bg-elevated)' : 'transparent',
        color: isActive ? 'var(--coral-bright)' : 'var(--text-secondary)',
        borderLeft: isActive ? '2px solid var(--coral-bright)' : '2px solid transparent',
      }}
      onClick={() => onFileSelect(node.path)}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span style={{ fontSize: '0.72rem' }}>{fileIcon(node.name)}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem' }}>{node.name}</span>
      </span>
      {hovered && (
        <button
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: '0.7rem', padding: '0 2px', flexShrink: 0 }}
          onClick={(e) => { e.stopPropagation(); onFileDelete(node.path); }}
          title="Delete"
        >✕</button>
      )}
    </div>
  );
}

export function FileExplorer({ files, activeFile, onFileSelect, onFileCreate, onFileDelete }: FileExplorerProps) {
  const [newFileName, setNewFileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const tree = buildTree(files);

  const handleCreate = () => {
    if (newFileName.trim()) {
      onFileCreate(newFileName.trim());
      setNewFileName('');
      setIsCreating(false);
    }
  };

  return (
    <div style={{ height: '100%', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-display)' }}>
          Explorer
        </span>
        <button
          onClick={() => setIsCreating(true)}
          title="New file"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
        >+</button>
      </div>

      {isCreating && (
        <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <input
            autoFocus
            value={newFileName}
            onChange={e => setNewFileName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setIsCreating(false); setNewFileName(''); }
            }}
            placeholder="src/newfile.ts"
            style={{
              width: '100%', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              fontSize: '0.78rem', padding: '4px 8px', borderRadius: 6,
              outline: 'none', border: '1px solid var(--coral-bright)',
              fontFamily: "'JetBrains Mono', monospace", boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 4 }}>
        {tree.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 12px', fontSize: '0.78rem' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>📂</div>
            No files yet.<br />Click + to create one.
          </div>
        ) : tree.map(node => (
          <TreeNodeComponent
            key={node.path}
            node={node}
            activeFile={activeFile}
            onFileSelect={onFileSelect}
            onFileDelete={onFileDelete}
          />
        ))}
      </div>
    </div>
  );
}
