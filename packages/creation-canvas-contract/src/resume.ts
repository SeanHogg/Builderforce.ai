/**
 * The résumé document, and the family of revisions one résumé object holds.
 *
 * ── WHY THIS IS A CONTRACT AND NOT FRONTEND CODE ─────────────────────────────────
 * A résumé is authored on the canvas, but it is READ in four other places that have
 * no browser: the for-hire upload path builds a family server-side from a PDF, the
 * public `/resume/:token` projection strips it down to one deliberate snapshot, the
 * ATS projects the selected revision into the employer's tenant when someone applies,
 * and the Recruiter agent tailors one against a job description.
 *
 * When the shape lived only in `frontend/src/lib/canvasResume.ts`, the server grew its
 * own partial copy of the family reader (`application/creation/publicResumeProjection.ts`)
 * — two answers to "which revision is the live one", which is exactly the drift that
 * makes a public link show a different résumé than the editor does. So the parts BOTH
 * sides need live here, once.
 *
 * What deliberately does NOT live here: template *definitions* (colours, density,
 * section layout) and Markdown rendering. Those are presentation, only the renderer
 * needs them, and putting them in the transport contract would drag styling into the
 * API bundle. Only the template IDENTIFIERS are shared, because a revision stores one.
 */

/** Every résumé design a revision may name. Builderforce first-party templates. */
export const RESUME_TEMPLATE_IDS = [
  'standard',
  'payroll-iron-gray',
  'risk-asphalt',
  'executive-taupe',
  'intern-education-first',
  'hospitality-amber',
  'creative-minimal',
  'software-engineer-graphite',
  'healthcare-clinical-blue',
  'sales-growth-emerald',
  'actor-headshot-hero',
  'director-filmography-serif',
] as const;
export type ResumeTemplateId = (typeof RESUME_TEMPLATE_IDS)[number];

export const DEFAULT_RESUME_TEMPLATE_ID: ResumeTemplateId = 'standard';

/**
 * Template ids retired by a rename, mapped to their replacement.
 *
 * `hired-default` was a vendor brand frozen into persisted data: every revision
 * authored before the rename carries it, and the family reader DROPS a revision
 * whose `templateId` it does not recognise — which, for the original revision,
 * discards the whole résumé. Migration 1060 rewrites the rows this platform
 * stores, but a guest board keeps its family in the browser and no migration
 * reaches that, so the read boundary normalises too.
 */
const RETIRED_RESUME_TEMPLATE_IDS: Record<string, ResumeTemplateId> = {
  'hired-default': 'standard',
};

/** A known template id for `value`, following a retired id to its replacement. */
export function normalizeResumeTemplateId(value: unknown): ResumeTemplateId | null {
  if (typeof value !== 'string') return null;
  if ((RESUME_TEMPLATE_IDS as readonly string[]).includes(value)) return value as ResumeTemplateId;
  return RETIRED_RESUME_TEMPLATE_IDS[value] ?? null;
}

export type ResumePageSize = 'letter' | 'legal' | 'a4';
export type ResumeOrientation = 'portrait' | 'landscape';
export type ResumePreviewMode = 'continuous' | 'paged' | 'spread';

/** Canonical section order of the JSON Resume schema, as this platform renders it. */
export const RESUME_SECTION_ORDER = [
  'summary', 'work', 'education', 'skills', 'volunteer', 'projects',
  'awards', 'certificates', 'publications', 'languages', 'interests', 'references',
] as const;
export type ResumeSectionId = (typeof RESUME_SECTION_ORDER)[number];

// ── The document (JSON Resume) ──────────────────────────────────────────────────

export interface CanvasResumeLocation extends Record<string, unknown> {
  address?: string; postalCode?: string; city?: string; countryCode?: string; region?: string;
}
export interface CanvasResumeBasics extends Record<string, unknown> {
  name?: string; label?: string; image?: string; email?: string; phone?: string;
  url?: string; summary?: string; location?: CanvasResumeLocation | null;
}
export interface CanvasResumeWork extends Record<string, unknown> {
  id?: string; name?: string; position?: string; url?: string; summary?: string;
  startDate?: string; endDate?: string; locationType?: string; employmentType?: string; highlights?: string[];
}
export interface CanvasResumeEducation extends Record<string, unknown> {
  id?: string; institution?: string; area?: string; studyType?: string;
  startDate?: string; endDate?: string; score?: string; url?: string; courses?: string[];
}
export interface CanvasResumeSkill extends Record<string, unknown> {
  id?: string; name?: string; level?: string; keywords?: string[]; yearsOfExperience?: number;
}
export interface CanvasResumeDocument extends Record<string, unknown> {
  basics?: CanvasResumeBasics;
  work?: CanvasResumeWork[];
  education?: CanvasResumeEducation[];
  skills?: CanvasResumeSkill[];
  volunteer?: Array<Record<string, unknown>>;
  awards?: Array<Record<string, unknown>>;
  certificates?: Array<Record<string, unknown>>;
  publications?: Array<Record<string, unknown>>;
  languages?: Array<Record<string, unknown>>;
  interests?: Array<Record<string, unknown>>;
  references?: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  builderforceLayout?: { sectionOrder?: string[]; hiddenSections?: string[] };
}

// ── The family (one object, many revisions) ─────────────────────────────────────

export type ResumeRevisionKind = 'original' | 'derived';

/**
 * `privacy` carries `draft` alongside the four visibility levels because an unfinished
 * résumé is not a *narrower audience*, it is not-yet-shown-to-anyone — and collapsing
 * the two would make "publish" indistinguishable from "widen the audience".
 */
export type ResumePrivacy = 'public' | 'recruiter_only' | 'connections' | 'private' | 'draft';

export interface CanvasResumeRevision {
  id: string;
  kind: ResumeRevisionKind;
  title: string;
  markdown: string;
  document?: CanvasResumeDocument;
  /** True when `markdown` has been edited since `document` was last derived from it. */
  structuredStale?: boolean;
  templateId: ResumeTemplateId;
  pageSize: ResumePageSize;
  orientation: ResumeOrientation;
  /** The immutable uploaded file this revision came from. Never exposed publicly. */
  sourceFile?: { key?: string | null; name: string; mimeType: string; size: number };
  sourceRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasResumeFamily {
  version: 1;
  privacy: ResumePrivacy;
  archivedAt: string | null;
  watched: boolean;
  defaultTemplateId: ResumeTemplateId;
  viewZoom: number;
  previewMode: ResumePreviewMode;
  /** The uploaded source. Never overwritten — "create me a new résumé" derives. */
  originalRevisionId: string;
  /** What the editor is showing. */
  activeRevisionId: string;
  /** The one a profile, a public link and an application resolve to by default. */
  masterRevisionId: string;
  revisions: CanvasResumeRevision[];
}

export function isResumeTemplateId(value: unknown): value is ResumeTemplateId {
  return typeof value === 'string' && (RESUME_TEMPLATE_IDS as readonly string[]).includes(value);
}

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Build a fresh family around one original revision.
 *
 * `idFactory` and `now` are injectable because the server builds families inside a
 * request that must be reproducible in a test, and `crypto.randomUUID` is not.
 */
export function createResumeFamily(args: {
  title: string;
  markdown: string;
  document?: CanvasResumeDocument;
  templateId?: ResumeTemplateId;
  sourceFile?: CanvasResumeRevision['sourceFile'];
  now?: string;
  idFactory?: () => string;
}): CanvasResumeFamily {
  const now = args.now ?? new Date().toISOString();
  const revisionId = (args.idFactory ?? (() => crypto.randomUUID()))();
  // The template travels WITH the family it belongs to, rather than being re-stamped
  // by the renderer — otherwise every résumé renders in the default no matter which
  // template was asked for.
  const templateId = normalizeResumeTemplateId(args.templateId) ?? DEFAULT_RESUME_TEMPLATE_ID;
  const original: CanvasResumeRevision = {
    id: revisionId,
    kind: 'original',
    title: args.title.trim(),
    markdown: args.markdown.trim(),
    ...(args.document ? { document: deepClone(args.document), structuredStale: false } : {}),
    templateId,
    pageSize: 'a4',
    orientation: 'portrait',
    ...(args.sourceFile ? { sourceFile: deepClone(args.sourceFile) } : {}),
    sourceRevisionId: null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    version: 1,
    privacy: 'private',
    archivedAt: null,
    watched: false,
    defaultTemplateId: templateId,
    viewZoom: 75,
    previewMode: 'continuous',
    originalRevisionId: revisionId,
    activeRevisionId: revisionId,
    masterRevisionId: revisionId,
    revisions: [original],
  };
}

/** The revision the editor is on, degrading to the original then to the first. */
export function activeResumeRevision(family: CanvasResumeFamily): CanvasResumeRevision {
  return family.revisions.find((revision) => revision.id === family.activeRevisionId)
    ?? family.revisions.find((revision) => revision.id === family.originalRevisionId)
    ?? family.revisions[0]!;
}

/**
 * The revision everything OUTSIDE the editor means by "their résumé" — a profile
 * embed, a public link, an application. Master first, then active, then original,
 * so a family that never had a master promoted still resolves to something real.
 */
export function masterResumeRevision(family: CanvasResumeFamily): CanvasResumeRevision {
  return family.revisions.find((revision) => revision.id === family.masterRevisionId)
    ?? family.revisions.find((revision) => revision.id === family.activeRevisionId)
    ?? family.revisions.find((revision) => revision.id === family.originalRevisionId)
    ?? family.revisions[0]!;
}

/**
 * Validate an untrusted value as a family. Returns null rather than throwing: this
 * reads JSONB written by older builds, and a résumé that fails to parse must render
 * as "no résumé", never as a 500.
 */
export function resumeFamilyFromValue(value: unknown): CanvasResumeFamily | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const family = value as Partial<CanvasResumeFamily>;
  if (!Array.isArray(family.revisions) || family.revisions.length === 0) return null;
  const revisions = family.revisions.filter((revision): revision is CanvasResumeRevision => {
    if (!revision || typeof revision !== 'object' || Array.isArray(revision)) return false;
    const row = revision as Partial<CanvasResumeRevision>;
    return typeof row.id === 'string' && typeof row.title === 'string' && typeof row.markdown === 'string';
  }).map((revision) => ({
    ...revision,
    templateId: normalizeResumeTemplateId(revision.templateId) ?? DEFAULT_RESUME_TEMPLATE_ID,
  }));
  if (revisions.length === 0) return null;
  const resolve = (candidate: unknown, fallback: string): string =>
    typeof candidate === 'string' && revisions.some((revision) => revision.id === candidate) ? candidate : fallback;
  const firstId = revisions[0]!.id;
  const originalRevisionId = resolve(family.originalRevisionId, firstId);
  return {
    version: 1,
    privacy: family.privacy ?? 'private',
    archivedAt: typeof family.archivedAt === 'string' ? family.archivedAt : null,
    watched: family.watched === true,
    defaultTemplateId: normalizeResumeTemplateId(family.defaultTemplateId) ?? DEFAULT_RESUME_TEMPLATE_ID,
    viewZoom: typeof family.viewZoom === 'number' ? family.viewZoom : 75,
    previewMode: family.previewMode ?? 'continuous',
    originalRevisionId,
    activeRevisionId: resolve(family.activeRevisionId, originalRevisionId),
    masterRevisionId: resolve(family.masterRevisionId, originalRevisionId),
    revisions,
  };
}

/** Privacy levels at which a résumé may be served to someone who is not its owner. */
const SHAREABLE_PRIVACY: ReadonlySet<ResumePrivacy> = new Set<ResumePrivacy>(['public', 'recruiter_only', 'connections']);

/**
 * Reduce a family to ONE deliberate snapshot for a public reader.
 *
 * Everything private is dropped rather than filtered at the edge: the revision
 * history (which names the jobs they applied for), and `sourceFile` (an R2 key).
 * The survivor is re-labelled as the only revision so a public viewer cannot tell
 * — or request — that others exist.
 */
export function projectPublicResumeFamily(
  value: unknown,
  opts: { audience?: 'public' | 'recruiter' } = {},
): CanvasResumeFamily | null {
  const family = resumeFamilyFromValue(value);
  if (!family || family.archivedAt) return null;
  const allowed = opts.audience === 'recruiter' ? SHAREABLE_PRIVACY : new Set<ResumePrivacy>(['public']);
  if (!allowed.has(family.privacy)) return null;
  const selected = masterResumeRevision(family);
  const { sourceFile: _omitted, ...safe } = selected;
  return {
    ...family,
    watched: false,
    originalRevisionId: selected.id,
    activeRevisionId: selected.id,
    masterRevisionId: selected.id,
    revisions: [{ ...safe, kind: 'original', sourceRevisionId: null }],
  };
}
