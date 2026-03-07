/**
 * Pure utility functions shared across components.
 * Extracted here so they can be unit-tested without a DOM.
 */

// ---------------------------------------------------------------------------
// Language detection (used by CodeEditor)
// ---------------------------------------------------------------------------

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  css: 'css',
  scss: 'scss',
  html: 'html',
  json: 'json',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  sh: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sql: 'sql',
};

export function getLanguage(filePath?: string): string {
  if (!filePath) return 'plaintext';
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_LANGUAGE_MAP[ext] ?? 'plaintext';
}

// ---------------------------------------------------------------------------
// File-name extraction (used by EditorTabs)
// ---------------------------------------------------------------------------

export function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

// ---------------------------------------------------------------------------
// File-tree builder (used by FileExplorer)
// ---------------------------------------------------------------------------

export interface FileEntry {
  path: string;
  content: string;
  type: 'file' | 'directory';
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

export function buildTree(files: FileEntry[]): TreeNode[] {
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
