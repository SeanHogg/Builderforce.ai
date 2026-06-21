/**
 * Blog data utilities.
 *
 * Blog posts are stored as Markdown files in src/content/blog/.
 * Each file starts with a YAML front-matter block (---…---) followed by the
 * post body in Markdown.
 *
 * Webpack is configured (next.config.js) to import *.md files as raw strings
 * (asset/source), so we can import them statically and parse them at runtime.
 * This is fully compatible with the Cloudflare edge runtime because no
 * filesystem access is required at request time — everything is bundled.
 */

import gettingStarted from '@/content/blog/getting-started-with-ai-agents.md';
import webgpuLora from '@/content/blog/webgpu-lora-explained.md';
import multiAgent from '@/content/blog/multi-agent-orchestration.md';
import datasetBestPractices from '@/content/blog/ai-dataset-generation-best-practices.md';
import introductionAndOverview from '@/content/blog/introduction-and-overview.md';
import builderforceIntegration from '@/content/blog/builderforce-agents-and-agent-integration.md';
import productIdeation from '@/content/blog/product-ideation-with-builderforce.md';
import approvalGates from '@/content/blog/approval-gates-and-human-oversight.md';
import fleetManagement from '@/content/blog/fleet-management-and-agent-routing.md';
import inBrowserIde from '@/content/blog/in-browser-ide-and-collaboration.md';
import securityMultiTenant from '@/content/blog/security-and-multi-tenant-architecture.md';
import skillsAssignment from '@/content/blog/skills-assignment-and-the-marketplace.md';
import specsAndPlanning from '@/content/blog/specs-and-planning-with-ai.md';
import taskExecution from '@/content/blog/task-execution-and-observability.md';

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  description: string;
  tags: string[];
  author: string;
  content: string;
}

/** Parse a YAML front-matter block and return metadata + body. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta, body: raw };

  const [, frontmatter, body] = match;
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) meta[key] = value;
  }
  return { meta, body };
}

/** Parse a YAML array like `[a, b, c]` or `- a\n- b` into a string array. */
function parseYamlArray(value: string): string[] {
  if (!value) return [];
  // Inline array: [tag1, tag2]
  const inlineMatch = value.match(/^\[(.*)\]$/);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Multi-line block arrays aren't used in these files; return as single tag.
  return [value];
}

function buildPost(slug: string, raw: string): BlogPost {
  const { meta, body } = parseFrontmatter(raw);
  // Strip the leading `# Title` H1 that duplicates the page title shown above
  // the content. Only removes a single top-level ATX heading (# followed by a
  // space), not ##/### subheadings.
  const cleanBody = body.trim().replace(/^# [^\n]*\n?/, '').trim();
  return {
    slug,
    title: meta.title ?? slug,
    date: meta.date ?? '',
    description: meta.description ?? '',
    tags: parseYamlArray(meta.tags ?? ''),
    author: meta.author ?? '',
    content: cleanBody,
  };
}

/** All published blog posts, sorted newest-first. */
export const BLOG_POSTS: BlogPost[] = [
  buildPost('getting-started-with-ai-agents', gettingStarted),
  buildPost('webgpu-lora-explained', webgpuLora),
  buildPost('multi-agent-orchestration', multiAgent),
  buildPost('ai-dataset-generation-best-practices', datasetBestPractices),
  buildPost('introduction-and-overview', introductionAndOverview),
  // Slug aligned to its filename (was 'builderforce-and-agent-integration', a
  // divergence from the source file). The old slug was only referenced here, so
  // no published URL breaks — the sitemap and routes derive from this array.
  buildPost('builderforce-agents-and-agent-integration', builderforceIntegration),
  buildPost('product-ideation-with-builderforce', productIdeation),
  buildPost('approval-gates-and-human-oversight', approvalGates),
  buildPost('fleet-management-and-agent-routing', fleetManagement),
  buildPost('in-browser-ide-and-collaboration', inBrowserIde),
  buildPost('security-and-multi-tenant-architecture', securityMultiTenant),
  buildPost('skills-assignment-and-the-marketplace', skillsAssignment),
  buildPost('specs-and-planning-with-ai', specsAndPlanning),
  buildPost('task-execution-and-observability', taskExecution),
].sort((a, b) => (a.date < b.date ? 1 : -1));

export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
