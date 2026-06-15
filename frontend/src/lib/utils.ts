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
// Markdown fence sanitizer (used by LegalDocPreview + the task PRD tab)
// ---------------------------------------------------------------------------

/**
 * LLM-authored Markdown documents (legal docs, task PRDs) sometimes arrive
 * wrapped in a whole-document fenced code block (```markdown … ``` or
 * ```PRIVACY_POLICY.md … ```), occasionally with conversational chatter around
 * it ("Okay, I can help you draft…"). Render that verbatim and the entire
 * document shows up as a raw monospace code block (a "MARKDOWN" labelled box)
 * instead of formatted prose.
 *
 * If the content contains a fenced code block whose info string looks like
 * Markdown (`md`, `markdown`, or any `*.md` filename), unwrap it: return the
 * block's inner body and discard the surrounding chatter. Otherwise the content
 * is already clean Markdown and is returned unchanged.
 */
export function unwrapMarkdownFence(content: string): string {
  // ```<info>\n<body>\n``` — info string captured to test whether it's Markdown.
  const fence = /```[ \t]*([^\n`]*)\r?\n([\s\S]*?)\r?\n?```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(content)) !== null) {
    const info = match[1].trim().toLowerCase();
    if (info === 'md' || info === 'markdown' || info.endsWith('.md')) {
      return match[2].trim();
    }
  }
  return content;
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
    // Drop empty segments so a stray leading/trailing/double slash never
    // produces a blank-named tree node (e.g. "foo//bar.json" or "/x.json").
    const parts = file.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;
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
