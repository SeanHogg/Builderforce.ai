'use client';

import { useState } from 'react';
import type { FileEntry } from '@/lib/types';

interface FileExplorerProps {
  files: FileEntry[];
  activeFile?: string;
  onFileSelect: (path: string) => void;
  onFileCreate: (path: string) => void;
  onFileDelete: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const map: Record<string, TreeNode> = {};

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = i === parts.length - 1;

      if (!map[currentPath]) {
        const node: TreeNode = {
          name: part,
          path: currentPath,
          type: isLast ? file.type : 'directory',
          children: isLast && file.type === 'file' ? undefined : [],
        };
        map[currentPath] = node;
        current.push(node);
      }
      if (!isLast) {
        current = map[currentPath].children!;
      }
    }
  }

  return root;
}

function TreeNodeComponent({
  node,
  activeFile,
  onFileSelect,
  onFileDelete,
  depth = 0,
}: {
  node: TreeNode;
  activeFile?: string;
  onFileSelect: (path: string) => void;
  onFileDelete: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.type === 'directory') {
    return (
      <div>
        <div
          className="flex items-center gap-1 px-2 py-0.5 hover:bg-gray-700 cursor-pointer text-sm text-gray-300"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <span>{expanded ? '▼' : '▶'}</span>
          <span>📁</span>
          <span>{node.name}</span>
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

  return (
    <div
      className={`flex items-center justify-between px-2 py-0.5 hover:bg-gray-700 cursor-pointer text-sm group ${
        activeFile === node.path ? 'bg-gray-600 text-white' : 'text-gray-400'
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onFileSelect(node.path)}
    >
      <span className="flex items-center gap-1 truncate">
        <span>📄</span>
        <span className="truncate">{node.name}</span>
      </span>
      <button
        className="hidden group-hover:block text-gray-500 hover:text-red-400 px-1"
        onClick={(e) => {
          e.stopPropagation();
          onFileDelete(node.path);
        }}
      >
        ✕
      </button>
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
    <div className="h-full bg-gray-800 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Files</span>
        <button
          className="text-gray-400 hover:text-white text-lg leading-none"
          onClick={() => setIsCreating(true)}
          title="New file"
        >
          +
        </button>
      </div>
      {isCreating && (
        <div className="px-2 py-1 border-b border-gray-700">
          <input
            autoFocus
            value={newFileName}
            onChange={e => setNewFileName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setIsCreating(false); setNewFileName(''); }
            }}
            placeholder="filename.ts"
            className="w-full bg-gray-700 text-white text-sm px-2 py-1 rounded outline-none border border-blue-500"
          />
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.map(node => (
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
