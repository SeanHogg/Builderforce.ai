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
import autonomousSwimlanes from '@/content/blog/autonomous-swimlane-execution.md';
import semanticCache from '@/content/blog/semantic-response-cache.md';
import bestAiCodingAgents from '@/content/blog/best-ai-coding-agents-compared.md';
import vsCopilot from '@/content/blog/builderforce-vs-github-copilot.md';
import vsCursor from '@/content/blog/builderforce-vs-cursor-windsurf.md';
import vsClaudeCode from '@/content/blog/builderforce-vs-claude-code.md';
import vsDevin from '@/content/blog/builderforce-vs-devin.md';
import systemOfRecord from '@/content/blog/system-of-record-for-agentic-work.md';
import everyRolePicture from '@/content/blog/every-role-operating-picture.md';
import evermind from '@/content/blog/evermind-self-updating-model.md';
import evermindArchitecture from '@/content/blog/inside-evermind-architecture.md';
import agentStack from '@/content/blog/agent-tech-stack-all-seven-layers.md';
import defineANeed from '@/content/blog/define-a-need-the-agentic-system-solves-it.md';
import planningSpine from '@/content/blog/planning-spine-cost-bearing-delivery.md';
import qualityObservability from '@/content/blog/quality-error-observability-one-click-fix.md';
import knowledgeManagement from '@/content/blog/knowledge-management-sops-and-compliance.md';
import boardConnectors from '@/content/blog/single-pane-board-connectors.md';
import agenticTester from '@/content/blog/agentic-tester-autonomous-qa.md';
import agenticWorkforce from '@/content/blog/transitioning-to-an-agentic-workforce.md';
import aiDevMaturity from '@/content/blog/ai-development-maturity-diagnostic.md';
import migrateAndIntegrate from '@/content/blog/migrate-and-integrate-jira-monday-rally-gitlab-bitbucket.md';
import agenticEmployee from '@/content/blog/everything-an-agentic-employee-can-do.md';
import realtimeCollaboration from '@/content/blog/real-time-collaboration-humans-and-agents.md';
import videoMeetings from '@/content/blog/video-meetings-standups-and-shared-calendars.md';
import multiPartyChat from '@/content/blog/multi-party-team-chat-humans-and-agents.md';
import vsCodeCommandCenter from '@/content/blog/vs-code-command-center-for-your-agentic-workforce.md';
import cobitGovernance from '@/content/blog/cobit-governance-readiness-for-agentic-it.md';
import psychometricPersonas from '@/content/blog/ai-agent-personality-psychometric-personas.md';
import incidentManagement from '@/content/blog/incident-management-on-call-and-war-rooms.md';
import roleAccountability from '@/content/blog/role-gated-accountability-proof-of-participation.md';
import rfpResponse from '@/content/blog/automated-rfp-response-from-your-codebase.md';
import memoryFirst from '@/content/blog/memory-first-inference-skip-the-llm.md';
import localFirstWebgpu from '@/content/blog/local-first-ai-webgpu-in-the-browser.md';

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
  buildPost('autonomous-swimlane-execution', autonomousSwimlanes),
  buildPost('semantic-response-cache', semanticCache),
  buildPost('best-ai-coding-agents-compared', bestAiCodingAgents),
  buildPost('builderforce-vs-github-copilot', vsCopilot),
  buildPost('builderforce-vs-cursor-windsurf', vsCursor),
  buildPost('builderforce-vs-claude-code', vsClaudeCode),
  buildPost('builderforce-vs-devin', vsDevin),
  buildPost('system-of-record-for-agentic-work', systemOfRecord),
  buildPost('every-role-operating-picture', everyRolePicture),
  buildPost('evermind-self-updating-model', evermind),
  buildPost('inside-evermind-architecture', evermindArchitecture),
  buildPost('agent-tech-stack-all-seven-layers', agentStack),
  buildPost('define-a-need-the-agentic-system-solves-it', defineANeed),
  buildPost('planning-spine-cost-bearing-delivery', planningSpine),
  buildPost('quality-error-observability-one-click-fix', qualityObservability),
  buildPost('knowledge-management-sops-and-compliance', knowledgeManagement),
  buildPost('single-pane-board-connectors', boardConnectors),
  buildPost('agentic-tester-autonomous-qa', agenticTester),
  buildPost('transitioning-to-an-agentic-workforce', agenticWorkforce),
  buildPost('ai-development-maturity-diagnostic', aiDevMaturity),
  buildPost('migrate-and-integrate-jira-monday-rally-gitlab-bitbucket', migrateAndIntegrate),
  buildPost('everything-an-agentic-employee-can-do', agenticEmployee),
  buildPost('real-time-collaboration-humans-and-agents', realtimeCollaboration),
  buildPost('video-meetings-standups-and-shared-calendars', videoMeetings),
  buildPost('multi-party-team-chat-humans-and-agents', multiPartyChat),
  buildPost('vs-code-command-center-for-your-agentic-workforce', vsCodeCommandCenter),
  buildPost('cobit-governance-readiness-for-agentic-it', cobitGovernance),
  buildPost('ai-agent-personality-psychometric-personas', psychometricPersonas),
  buildPost('incident-management-on-call-and-war-rooms', incidentManagement),
  buildPost('role-gated-accountability-proof-of-participation', roleAccountability),
  buildPost('automated-rfp-response-from-your-codebase', rfpResponse),
  buildPost('memory-first-inference-skip-the-llm', memoryFirst),
].sort((a, b) => (a.date < b.date ? 1 : -1));

export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

/**
 * Resolve an explicit, ordered list of slugs to their posts (missing slugs are
 * skipped). Used to attach curated "related reading" to marketing surfaces via
 * the RELATED_ARTICLES map in content.ts — single source of truth for which
 * articles back which page.
 */
export function getPostsBySlugs(slugs: string[]): BlogPost[] {
  return slugs.map((s) => getPostBySlug(s)).filter((p): p is BlogPost => Boolean(p));
}

/**
 * Find posts related to a given post by shared tags, newest-first, excluding the
 * post itself. Powers the "Related articles" block at the foot of each blog post
 * without hand-maintaining a per-post list.
 */
export function getRelatedByTags(slug: string, limit = 3): BlogPost[] {
  const post = getPostBySlug(slug);
  if (!post) return [];
  const tags = new Set(post.tags);
  return BLOG_POSTS.filter((p) => p.slug !== slug)
    .map((p) => ({ post: p, overlap: p.tags.filter((t) => tags.has(t)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => (b.overlap - a.overlap) || (a.post.date < b.post.date ? 1 : -1))
    .slice(0, limit)
    .map((x) => x.post);
}
