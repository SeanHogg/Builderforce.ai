/**
 * One deterministic definition of documentation-only delivery.
 *
 * Agent finish gates and Manager review gates must classify the same set of paths;
 * otherwise an agent can finish a plan-only run that the Manager later mistakes for
 * implementation. Paths are repository-relative and may use either slash style.
 */

export type DeliverableEvidence = 'none' | 'docs_only' | 'implementation' | 'unknown';

const DOCUMENT_EXTENSIONS = new Set([
  '.md', '.mdx', '.rst', '.adoc', '.asciidoc', '.txt',
]);

export function isDocumentationPath(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('docs/') || normalized.startsWith('specs/')) return true;
  const file = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dot = file.lastIndexOf('.');
  return dot >= 0 && DOCUMENT_EXTENSIONS.has(file.slice(dot));
}
/** Empty means no recorded deliverable; any non-document path is implementation. */
export function classifyDeliverablePaths(paths: Iterable<string>): Exclude<DeliverableEvidence, 'unknown'> {
  let sawPath = false;
  for (const path of paths) {
    if (!path.trim()) continue;
    sawPath = true;
    if (!isDocumentationPath(path)) return 'implementation';
  }
  return sawPath ? 'docs_only' : 'none';
}
