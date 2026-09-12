/**
 * The product's STRUCTURE — which capabilities and screens exist, where each
 * lives, what state it is in, and what evidence backs it.
 *
 * Every visible word is catalog copy, index-aligned with the lists here:
 *   - `features[i]`                  — the platform capability cards
 *   - `agents.capabilities[i]`       ↔ {@link AGENT_CAPABILITIES}[i]
 *   - `product.sections[s]`          ↔ {@link PRODUCT_SECTIONS}[s] (and its surfaces)
 *   - `product.integrationMatrix.items[i]` ↔ {@link INTEGRATION_CAPABILITY_PROOF}[i]
 *   - `product.workflowLimitations[i]`     ↔ {@link WORKFLOW_PROOF_DEMOS}[i]
 *   - `marketing.content.product.operations.<surfaceId>` and
 *     `marketing.content.product.prerequisites.<id>` for the disclosures.
 * `messages.test.ts` asserts the alignment in all five locales.
 */
import { contentKey, rawList, type CopyReader } from './copy';

/* ════════════════════ THE FEATURE SHAPE ════════════════════ */

/**
 * THE FEATURE SHAPE — one description of "a thing this product does".
 *
 * Three lists on the public site describe capabilities — the platform's
 * (`features`), the agent runtime's (`agents.capabilities`) and the screens
 * (`product.sections[].surfaces`) — and each had invented its own field names
 * for the same facts. The CONTENT stays three lists, because they answer three
 * questions. What is unified is the SHAPE: `asFeature()` projects any of them,
 * and `content.featureShape.test.ts` asserts the projection is total and that no
 * title appears in two lists.
 */
export interface Feature {
  icon?: string;
  title: string;
  /** One line. The card, the list row, the meta description. */
  shortDesc: string;
  /** The full paragraph. Optional — a surface row has no long form. */
  longDesc?: string;
  /** Where it lives, when it has an address. */
  href?: string;
}

/** Anything the public site describes as a capability, in the one shape. */
export type FeatureLike =
  | Feature
  | { iconKey: string; title: string; description: string; href: string }
  | { icon: string; title: string; desc: string; href: string };

/**
 * Project any of the three lists onto {@link Feature}.
 *
 * `iconKey` stays a KEY rather than being resolved here: these modules are
 * JSX-free on purpose, and the glyph is the rendering surface's business.
 */
export function asFeature(item: FeatureLike): Feature {
  if ('shortDesc' in item) return item;
  if ('description' in item) {
    return { icon: item.iconKey, title: item.title, shortDesc: item.description, href: item.href };
  }
  return { icon: item.icon, title: item.title, shortDesc: item.desc, href: item.href };
}

/** The platform capability cards, localized — the `features` catalog array. */
export function featuresCopy(t: CopyReader): Feature[] {
  return rawList<Feature>(t, 'features');
}

/* ════════════════════ AGENT CAPABILITIES (/agents) ════════════════════ */

/**
 * An agent-runtime capability on the public `/agents` page. The title and
 * description are `agents.capabilities[i]` (backtick-wrapped tokens in the
 * description render as inline <code>); the glyph is a stable `iconKey`
 * resolved to an SVG by the rendering surface.
 */
export interface AgentCapability {
  /** Where the card links to (FeatureCard derives external/docs/internal from this). */
  href: string;
  /** Stable glyph key resolved to an SVG by the rendering surface. */
  iconKey: string;
}

export const AGENT_CAPABILITIES: AgentCapability[] = [
  { href: '/docs/start/getting-started', iconKey: 'cpu' },
  { href: '/', iconKey: 'mesh' },
  { href: '/docs/start/getting-started', iconKey: 'trending' },
  { href: '/docs/agents-overview', iconKey: 'pulse' },
  { href: '/workforce?tab=approvals', iconKey: 'users' },
  { href: '/docs/agents-link', iconKey: 'bolt' },
  { href: '/docs/tools/browser', iconKey: 'globe' },
  { href: '/docs/tools/exec', iconKey: 'terminal' },
  { href: '/agents/skills', iconKey: 'gear' },
  { href: '/docs/deep-understanding', iconKey: 'layers' },
  { href: '/agents/workflow-builder', iconKey: 'flow' },
  { href: '/docs/agents-workflows', iconKey: 'activity' },
  { href: '/security', iconKey: 'shield' },
  { href: '/settings?sub=logs', iconKey: 'bars' },
  { href: '/docs/agents-workflows', iconKey: 'swimlane' },
  { href: '/docs/start/getting-started', iconKey: 'git' },
  { href: 'https://github.com/SeanHogg/Builderforce.ai', iconKey: 'globe' },
];

/* ════════════════════ PRODUCT SURFACES (public capability tour) ════════════════════ */

/** A screen. Its title/desc are `product.sections[s].surfaces[f]`. */
export interface ProductSurface {
  /** Stable id — keys the proof, the operational disclosure and its copy. */
  id: string;
  icon: string;
  /** Where the authenticated surface lives (deep link after sign-in). */
  href: string;
}

export interface ProductSection {
  id: string;
  /** Emoji used as the section's icon in the product map. */
  icon: string;
  surfaces: ProductSurface[];
}

/**
 * The actual in-app surfaces, described for logged-out visitors. Mirrors the
 * authenticated navigation so the public /product page stays in lock-step with
 * what the app really ships.
 */
export const PRODUCT_SECTIONS: ProductSection[] = [
  {
    id: 'build',
    icon: '🛠',
    surfaces: [
      { id: 'creationCanvas', icon: '✦', href: '/creation-canvas' },
      { id: 'sessionLibrary', icon: '🏠', href: '/dashboard' },
      { id: 'workflowsEvaluation', icon: '🔀', href: '/create' },
      { id: 'websitesDataPrototypes', icon: '▣', href: '/create' },
      { id: 'evermindLlmVoice', icon: '🧠', href: '/create' },
      { id: 'creationCanvasVsCode', icon: '🧩', href: 'https://marketplace.visualstudio.com/items?itemName=BuilderForce.builderforce-ai' },
    ],
  },
  {
    id: 'orchestrate',
    icon: '🔀',
    surfaces: [
      { id: 'workflowExecution', icon: '🔀', href: '/create' },
      { id: 'projectsTasks', icon: '▦', href: '/projects' },
      { id: 'planningSpine', icon: '🗺️', href: '/projects?tab=portfolio' },
      { id: 'boardConnectors', icon: '🔗', href: '/projects?tab=connections' },
      { id: 'workforceMesh', icon: '🕸️', href: '/workforce' },
      { id: 'sessionConversations', icon: '💬', href: '/create' },
      { id: 'workforceKanban', icon: '🧑‍🏭', href: '/projects?tab=templates' },
    ],
  },
  {
    id: 'extend',
    icon: '🧩',
    surfaces: [
      { id: 'knowledgeSops', icon: '📚', href: '/knowledge' },
      { id: 'skills', icon: '⭐', href: '/skills' },
      { id: 'personas', icon: '👤', href: '/personas' },
      { id: 'promptLibrary', icon: '📚', href: '/prompts' },
      { id: 'contentManager', icon: '✎', href: '/content-manager' },
    ],
  },
  {
    id: 'govern',
    icon: '🛡',
    surfaces: [
      { id: 'approvals', icon: '✅', href: '/workforce?tab=approvals' },
      { id: 'security', icon: '🔒', href: '/security' },
      { id: 'observability', icon: '📊', href: '/settings?sub=logs' },
      { id: 'qualityErrors', icon: '🐞', href: '/quality' },
      { id: 'maturityDiagnostic', icon: '📈', href: '/tools/agentic-maturity' },
      { id: 'tenants', icon: '🏢', href: '/tenants' },
    ],
  },
];

/** A product section with its copy resolved for one locale. */
export interface LocalizedProductSection extends Omit<ProductSection, 'surfaces'> {
  title: string;
  blurb: string;
  surfaces: (ProductSurface & { title: string; desc: string })[];
}

type SectionCopy = { title?: string; blurb?: string; surfaces?: { title?: string; desc?: string }[] };

/**
 * Catalog key of one surface's copy — `product.sections.<s>.surfaces.<f>.<field>`
 * — for a registry that resolves keys one at a time (`lib/routeMarketing.ts`).
 */
export function productSurfaceKey(sectionIndex: number, surfaceIndex: number, field: 'title' | 'desc'): string {
  return `product.sections.${sectionIndex}.surfaces.${surfaceIndex}.${field}`;
}

/**
 * {@link PRODUCT_SECTIONS} with its localized copy (`product.sections`) paired in
 * by index. Consumers render THIS rather than zipping the two arrays themselves.
 */
export function productSectionsCopy(t: CopyReader): LocalizedProductSection[] {
  const copy = rawList<SectionCopy>(t, 'product.sections');
  return PRODUCT_SECTIONS.map((section, si) => ({
    ...section,
    title: copy[si]?.title ?? '',
    blurb: copy[si]?.blurb ?? '',
    surfaces: section.surfaces.map((surface, fi) => ({
      ...surface,
      title: copy[si]?.surfaces?.[fi]?.title ?? '',
      desc: copy[si]?.surfaces?.[fi]?.desc ?? '',
    })),
  }));
}

/* ════════════════════ CAPABILITY PROOF ════════════════════ */

export type CapabilityStatus = 'available' | 'beta' | 'planned';
export type CapabilityDataBoundary = 'browser' | 'workspace-cloud' | 'connected-service' | 'hybrid';

/** Prerequisite ids — each labelled at `marketing.content.product.prerequisites.<id>`. */
export const PREREQUISITE_IDS = [
  'account',
  'webgpuDevice',
  'vscodeExtension',
  'sharedSessionsAccount',
  'agentHost',
  'providerCredentials',
  'installOrPublishAccount',
  'publishAccount',
  'policyGate',
  'deploymentConfig',
  'instrumentedExecution',
  'errorSource',
] as const;

export type PrerequisiteId = (typeof PREREQUISITE_IDS)[number];

export interface CapabilityProof {
  status: CapabilityStatus;
  dataBoundary: CapabilityDataBoundary;
  prerequisites: readonly PrerequisiteId[];
  /** Repository-relative automated or implementation evidence. */
  evidence: readonly string[];
  /** ISO date on which the evidence was last reviewed. */
  lastVerified: string;
}

/**
 * Public capability-claim contract, keyed by surface id. A product surface
 * cannot appear in the marketing catalog without an explicit maturity state,
 * execution/data boundary, prerequisites, and code evidence.
 */
export const PRODUCT_CAPABILITY_PROOF: Record<string, CapabilityProof> = {
  creationCanvas: { status: 'beta', dataBoundary: 'hybrid', prerequisites: [], evidence: ['frontend/src/components/creation-canvas/CreationCanvas.test.tsx'], lastVerified: '2026-08-04' },
  sessionLibrary: { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/lib/builderforceApi.ts', 'frontend/src/components/creation-sessions/SessionActionBar.tsx'], lastVerified: '2026-08-22' },
  workflowsEvaluation: { status: 'beta', dataBoundary: 'hybrid', prerequisites: ['account'], evidence: ['frontend/src/lib/creationCanvasAi.test.ts'], lastVerified: '2026-08-04' },
  websitesDataPrototypes: { status: 'beta', dataBoundary: 'hybrid', prerequisites: [], evidence: ['frontend/src/components/creation-canvas/creationObjectRegistry.ts'], lastVerified: '2026-08-04' },
  evermindLlmVoice: { status: 'beta', dataBoundary: 'hybrid', prerequisites: ['webgpuDevice'], evidence: ['frontend/src/domains/workflow/presentation/EvermindBuildPanel.tsx'], lastVerified: '2026-08-04' },
  creationCanvasVsCode: { status: 'beta', dataBoundary: 'hybrid', prerequisites: ['vscodeExtension', 'sharedSessionsAccount'], evidence: ['packages/creation-canvas-contract/src/index.ts'], lastVerified: '2026-08-04' },
  workflowExecution: { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/components/WorkflowDagView.tsx'], lastVerified: '2026-08-04' },
  projectsTasks: { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/components/TaskMgmtContent.tsx'], lastVerified: '2026-08-04' },
  planningSpine: { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/components/pm/PlanningSpineGantt.tsx'], lastVerified: '2026-08-04' },
  boardConnectors: { status: 'beta', dataBoundary: 'connected-service', prerequisites: ['providerCredentials'], evidence: ['api/src/application/boardsync/providerCatalog.ts'], lastVerified: '2026-08-04' },
  workforceMesh: { status: 'beta', dataBoundary: 'hybrid', prerequisites: ['agentHost'], evidence: ['frontend/src/components/workforce/WorkforceAgents.tsx'], lastVerified: '2026-08-04' },
  sessionConversations: { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/components/creation-canvas/CreationCanvas.tsx'], lastVerified: '2026-08-04' },
  workforceKanban: { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/components/TaskMgmtContent.tsx'], lastVerified: '2026-08-04' },
  knowledgeSops: { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/app/knowledge/page.tsx'], lastVerified: '2026-08-04' },
  skills: { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['installOrPublishAccount'], evidence: ['frontend/src/app/skills/page.tsx'], lastVerified: '2026-08-04' },
  personas: { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/app/personas/page.tsx'], lastVerified: '2026-08-04' },
  promptLibrary: { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['publishAccount'], evidence: ['frontend/src/app/prompts/page.tsx'], lastVerified: '2026-08-04' },
  contentManager: { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/app/content-manager/page.tsx'], lastVerified: '2026-08-04' },
  approvals: { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['policyGate'], evidence: ['api/src/application/runtime/RuntimeService.policyGates.test.ts'], lastVerified: '2026-08-04' },
  security: { status: 'available', dataBoundary: 'hybrid', prerequisites: ['deploymentConfig'], evidence: ['api/src/application/governance/policyPackService.test.ts'], lastVerified: '2026-08-04' },
  observability: { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['instrumentedExecution'], evidence: ['frontend/src/components/ObservabilityContent.tsx'], lastVerified: '2026-08-04' },
  qualityErrors: { status: 'beta', dataBoundary: 'connected-service', prerequisites: ['errorSource'], evidence: ['frontend/src/app/quality/page.tsx'], lastVerified: '2026-08-04' },
  maturityDiagnostic: { status: 'beta', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/app/diagnostics/page.tsx'], lastVerified: '2026-08-04' },
  tenants: { status: 'available', dataBoundary: 'workspace-cloud', prerequisites: ['account'], evidence: ['frontend/src/app/tenants/page.tsx'], lastVerified: '2026-08-04' },
};

/**
 * Operational disclosure paired one-to-one with the capability catalog. The
 * owner, limitation and export labels are copy at
 * `marketing.content.product.operations.<surfaceId>`; the example route is not.
 */
export interface CapabilityOperations {
  exampleHref: string;
}

export const PRODUCT_CAPABILITY_OPERATIONS: Record<string, CapabilityOperations> = {
  creationCanvas: { exampleHref: '/creation-canvas' },
  sessionLibrary: { exampleHref: '/dashboard' },
  workflowsEvaluation: { exampleHref: '/creation-canvas' },
  websitesDataPrototypes: { exampleHref: '/creation-canvas' },
  evermindLlmVoice: { exampleHref: '/evermind' },
  creationCanvasVsCode: { exampleHref: '/agents' },
  workflowExecution: { exampleHref: '/agents/workflow-builder' },
  projectsTasks: { exampleHref: '/projects' },
  planningSpine: { exampleHref: '/projects' },
  boardConnectors: { exampleHref: '/integrations' },
  workforceMesh: { exampleHref: '/workforce' },
  sessionConversations: { exampleHref: '/creation-canvas' },
  workforceKanban: { exampleHref: '/projects?tab=tasks' },
  knowledgeSops: { exampleHref: '/knowledge' },
  skills: { exampleHref: '/skills' },
  personas: { exampleHref: '/personas' },
  promptLibrary: { exampleHref: '/prompts' },
  contentManager: { exampleHref: '/content-manager' },
  approvals: { exampleHref: '/workforce?tab=approvals' },
  security: { exampleHref: '/security' },
  observability: { exampleHref: '/settings?sub=logs' },
  qualityErrors: { exampleHref: '/quality' },
  maturityDiagnostic: { exampleHref: '/tools/agentic-maturity' },
  tenants: { exampleHref: '/tenants' },
};

/** Catalog key of a surface's operational disclosure field. */
export function operationsKey(surfaceId: string, field: 'owner' | 'limitation' | 'exports'): string {
  return contentKey(`product.operations.${surfaceId}.${field}`);
}

/** Catalog key of a prerequisite's label. */
export function prerequisiteKey(id: PrerequisiteId): string {
  return contentKey(`product.prerequisites.${id}`);
}

/* ════════════════════ HIGH-RISK CLAIMS ════════════════════ */

export interface MarketingClaim {
  id: string;
  /** Compliance-approved English wording — a governance record, not rendered copy. */
  approvedCopy: string;
  status: CapabilityStatus;
  scope: string;
  dataBoundaries: readonly CapabilityDataBoundary[];
  evidence: readonly string[];
  owner: string;
  lastReviewed: string;
  reviewBy: string;
  complianceReview: 'required' | 'not-required';
}

/**
 * Canonical wording for high-risk public claims — the approval register that
 * marketing copy is reviewed against. No page renders these records; they are
 * the source a translation of a claim is checked against, which is why they
 * stay English here rather than moving to the catalogs.
 */
export const MARKETING_CLAIMS: readonly MarketingClaim[] = [
  {
    id: 'creative-canvas-delivery',
    approvedCopy: 'Builderforce connects supported creative artifacts to review and delivery surfaces in one Creation Session.',
    status: 'beta',
    scope: 'Supported Creation Canvas objects and named delivery paths',
    dataBoundaries: ['browser', 'workspace-cloud', 'hybrid'],
    evidence: ['frontend/src/components/creation-canvas/CreationCanvas.test.tsx'],
    owner: 'Creation', lastReviewed: '2026-08-04', reviewBy: '2026-11-02', complianceReview: 'not-required',
  },
  {
    id: 'human-approval-control',
    approvedCopy: 'Configured agent execution paths can require human approval, and dispatch is blocked when policy resolution fails.',
    status: 'available',
    scope: 'Runtime paths wired to the effective policy resolver',
    dataBoundaries: ['workspace-cloud', 'hybrid'],
    evidence: ['api/src/application/runtime/RuntimeService.policyGates.test.ts'],
    owner: 'Runtime & Governance', lastReviewed: '2026-08-04', reviewBy: '2026-11-02', complianceReview: 'required',
  },
  {
    id: 'credential-encryption',
    approvedCopy: 'Credentials stored for supported integrations are encrypted with AES-256-GCM and scoped to a tenant.',
    status: 'available',
    scope: 'Credential stores covered by the integration encryption implementation',
    dataBoundaries: ['workspace-cloud', 'connected-service'],
    evidence: ['api/src/application/integrations/credentialCrypto.test.ts'],
    owner: 'Security', lastReviewed: '2026-08-04', reviewBy: '2026-10-03', complianceReview: 'required',
  },
  {
    id: 'browser-local-compute',
    approvedCopy: 'Supported WebGPU training and generation steps run in the browser; remote evaluation, collaboration, publishing, and connected services use their stated external boundaries.',
    status: 'beta',
    scope: 'Named WebGPU operations on compatible devices',
    dataBoundaries: ['browser', 'hybrid'],
    evidence: ['frontend/src/domains/workflow/presentation/EvermindBuildPanel.tsx'],
    owner: 'AI Studio', lastReviewed: '2026-08-04', reviewBy: '2026-11-02', complianceReview: 'required',
  },
  {
    id: 'private-runtime-deployment',
    approvedCopy: 'The MIT-licensed BuilderForce Agents runtime can run on private infrastructure and use supported local models; hosted platform features remain separate services.',
    status: 'beta',
    scope: 'BuilderForce Agents runtime, excluding hosted collaboration and publishing services',
    dataBoundaries: ['hybrid'],
    evidence: ['agent-runtime/package.json', 'agent-runtime/docs/CLOUD_DEPLOY.md'],
    owner: 'Agent Runtime', lastReviewed: '2026-08-04', reviewBy: '2026-10-03', complianceReview: 'required',
  },
  {
    id: 'execution-observability',
    approvedCopy: 'Instrumented platform workflows emit available execution, usage, and tool-call records; coverage varies by surface.',
    status: 'beta',
    scope: 'Instrumented runtime and workflow paths',
    dataBoundaries: ['workspace-cloud', 'hybrid'],
    evidence: ['frontend/src/components/ObservabilityContent.tsx'],
    owner: 'Observability', lastReviewed: '2026-08-04', reviewBy: '2026-11-02', complianceReview: 'required',
  },
] as const;

/* ════════════════════ INTEGRATION & WORKFLOW PROOF ════════════════════ */

/**
 * A named, evidenced connector. `name` is a proper noun; its authentication
 * requirement and current limitation are `product.integrationMatrix.items[i]`.
 */
export interface IntegrationProof {
  name: string;
  status: CapabilityStatus;
  direction: 'import' | 'export' | 'two-way' | 'event-ingest';
  dataBoundary: 'connected-service';
  evidence: string;
  lastVerified: string;
}

/** Public integration matrix: named connectors only, with no implied universal coverage. */
export const INTEGRATION_CAPABILITY_PROOF: readonly IntegrationProof[] = [
  { name: 'GitHub', status: 'beta', direction: 'two-way', dataBoundary: 'connected-service', evidence: 'api/src/presentation/routes/githubWebhookRoutes.ts', lastVerified: '2026-08-04' },
  { name: 'Jira', status: 'beta', direction: 'two-way', dataBoundary: 'connected-service', evidence: 'api/src/application/boardsync/providerCatalog.ts', lastVerified: '2026-08-04' },
  { name: 'Confluence', status: 'beta', direction: 'import', dataBoundary: 'connected-service', evidence: 'api/src/application/boardsync/providerCatalog.ts', lastVerified: '2026-08-04' },
  { name: 'Sentry', status: 'beta', direction: 'event-ingest', dataBoundary: 'connected-service', evidence: 'api/src/application/quality/errorEventsLedger.ts', lastVerified: '2026-08-04' },
  { name: 'PostHog', status: 'beta', direction: 'event-ingest', dataBoundary: 'connected-service', evidence: 'api/src/application/quality/errorEventsLedger.ts', lastVerified: '2026-08-04' },
] as const;

/** A conversion workflow demo. Its copy is `home.workflowProof.demos[i]`; its limitation `product.workflowLimitations[i]`. */
export interface WorkflowProofDemo {
  id: string;
  status: 'beta';
  dataBoundary: CapabilityDataBoundary;
  evidence: readonly string[];
}

/** Three conversion workflows backed by repository-owned journey evidence. */
export const WORKFLOW_PROOF_DEMOS: readonly WorkflowProofDemo[] = [
  { id: 'idea-to-experience', status: 'beta', dataBoundary: 'hybrid', evidence: ['frontend/src/components/creation-canvas/CreationCanvas.test.tsx'] },
  { id: 'governed-agent-delivery', status: 'beta', dataBoundary: 'hybrid', evidence: ['api/src/application/runtime/RuntimeService.policyGates.test.ts'] },
  { id: 'signal-to-decision', status: 'beta', dataBoundary: 'connected-service', evidence: ['frontend/src/lib/creationCanvasAi.test.ts'] },
] as const;
