import type { CreationNodeData } from '@/components/creation-canvas/types';

export const RESUME_TEMPLATE_IDS = [
  'hired-default',
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

export interface ResumeTemplateDefinition {
  id: ResumeTemplateId;
  labelKey: `template_${ResumeTemplateId}`;
  mode: 'hero' | 'print';
  columns: 1 | 2;
  accent: string;
  paper: string;
  ink: string;
  font: 'sans' | 'serif' | 'mono';
  density: 'compact' | 'comfortable' | 'spacious';
}

export const RESUME_TEMPLATES: readonly ResumeTemplateDefinition[] = [
  { id: 'hired-default', labelKey: 'template_hired-default', mode: 'hero', columns: 1, accent: '#7c3aed', paper: '#ffffff', ink: '#172033', font: 'sans', density: 'comfortable' },
  { id: 'payroll-iron-gray', labelKey: 'template_payroll-iron-gray', mode: 'print', columns: 2, accent: '#475569', paper: '#ffffff', ink: '#1e293b', font: 'serif', density: 'compact' },
  { id: 'risk-asphalt', labelKey: 'template_risk-asphalt', mode: 'print', columns: 2, accent: '#27272a', paper: '#ffffff', ink: '#18181b', font: 'sans', density: 'comfortable' },
  { id: 'executive-taupe', labelKey: 'template_executive-taupe', mode: 'print', columns: 1, accent: '#78716c', paper: '#ffffff', ink: '#292524', font: 'serif', density: 'spacious' },
  { id: 'intern-education-first', labelKey: 'template_intern-education-first', mode: 'print', columns: 1, accent: '#1d4ed8', paper: '#ffffff', ink: '#172033', font: 'sans', density: 'comfortable' },
  { id: 'hospitality-amber', labelKey: 'template_hospitality-amber', mode: 'print', columns: 1, accent: '#b45309', paper: '#ffffff', ink: '#292524', font: 'sans', density: 'comfortable' },
  { id: 'creative-minimal', labelKey: 'template_creative-minimal', mode: 'print', columns: 1, accent: '#525252', paper: '#ffffff', ink: '#171717', font: 'mono', density: 'spacious' },
  { id: 'software-engineer-graphite', labelKey: 'template_software-engineer-graphite', mode: 'print', columns: 2, accent: '#047857', paper: '#ffffff', ink: '#172033', font: 'mono', density: 'comfortable' },
  { id: 'healthcare-clinical-blue', labelKey: 'template_healthcare-clinical-blue', mode: 'print', columns: 2, accent: '#1d4ed8', paper: '#ffffff', ink: '#172033', font: 'sans', density: 'compact' },
  { id: 'sales-growth-emerald', labelKey: 'template_sales-growth-emerald', mode: 'print', columns: 1, accent: '#047857', paper: '#ffffff', ink: '#172033', font: 'sans', density: 'comfortable' },
  { id: 'actor-headshot-hero', labelKey: 'template_actor-headshot-hero', mode: 'hero', columns: 1, accent: '#404040', paper: '#ffffff', ink: '#171717', font: 'serif', density: 'compact' },
  { id: 'director-filmography-serif', labelKey: 'template_director-filmography-serif', mode: 'print', columns: 1, accent: '#78716c', paper: '#ffffff', ink: '#292524', font: 'serif', density: 'spacious' },
] as const;

export type ResumeRevisionKind = 'original' | 'derived';

export interface CanvasResumeRevision {
  id: string;
  kind: ResumeRevisionKind;
  title: string;
  markdown: string;
  templateId: ResumeTemplateId;
  sourceRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasResumeFamily {
  version: 1;
  originalRevisionId: string;
  activeRevisionId: string;
  masterRevisionId: string;
  revisions: CanvasResumeRevision[];
}

const id = () => crypto.randomUUID();

export function createResumeFamily(args: { title: string; markdown: string; now?: string; idFactory?: () => string }): CanvasResumeFamily {
  const now = args.now ?? new Date().toISOString();
  const revisionId = (args.idFactory ?? id)();
  const original: CanvasResumeRevision = {
    id: revisionId,
    kind: 'original',
    title: args.title.trim(),
    markdown: args.markdown.trim(),
    templateId: 'hired-default',
    sourceRevisionId: null,
    createdAt: now,
    updatedAt: now,
  };
  return { version: 1, originalRevisionId: revisionId, activeRevisionId: revisionId, masterRevisionId: revisionId, revisions: [original] };
}

export function activeResumeRevision(family: CanvasResumeFamily): CanvasResumeRevision {
  return family.revisions.find((revision) => revision.id === family.activeRevisionId)
    ?? family.revisions.find((revision) => revision.id === family.originalRevisionId)
    ?? family.revisions[0]!;
}

export function originalResumeRevision(family: CanvasResumeFamily): CanvasResumeRevision {
  return family.revisions.find((revision) => revision.id === family.originalRevisionId) ?? family.revisions[0]!;
}

export function deriveResume(
  family: CanvasResumeFamily,
  title: string,
  options: { fromRevisionId?: string; now?: string; idFactory?: () => string } = {},
): CanvasResumeFamily {
  const source = family.revisions.find((revision) => revision.id === options.fromRevisionId)
    ?? originalResumeRevision(family);
  const now = options.now ?? new Date().toISOString();
  const revision: CanvasResumeRevision = {
    ...source,
    id: (options.idFactory ?? id)(),
    kind: 'derived',
    title: title.trim() || source.title,
    sourceRevisionId: source.id,
    createdAt: now,
    updatedAt: now,
  };
  return { ...family, activeRevisionId: revision.id, revisions: [...family.revisions, revision] };
}

export function selectResumeRevision(family: CanvasResumeFamily, revisionId: string): CanvasResumeFamily {
  return family.revisions.some((revision) => revision.id === revisionId)
    ? { ...family, activeRevisionId: revisionId }
    : family;
}

export function updateActiveResume(
  family: CanvasResumeFamily,
  patch: Partial<Pick<CanvasResumeRevision, 'title' | 'markdown' | 'templateId'>>,
  now = new Date().toISOString(),
): CanvasResumeFamily {
  const active = activeResumeRevision(family);
  if (active.kind === 'original') return family;
  return {
    ...family,
    revisions: family.revisions.map((revision) => revision.id === active.id
      ? { ...revision, ...patch, updatedAt: now }
      : revision),
  };
}

export function restoreResumeAsNew(
  family: CanvasResumeFamily,
  revisionId: string,
  title: string,
  options: { now?: string; idFactory?: () => string } = {},
): CanvasResumeFamily {
  return deriveResume(family, title, { ...options, fromRevisionId: revisionId });
}

export function promoteResumeToMaster(family: CanvasResumeFamily, revisionId: string): CanvasResumeFamily {
  return family.revisions.some((revision) => revision.id === revisionId)
    ? { ...family, masterRevisionId: revisionId, activeRevisionId: revisionId }
    : family;
}

export function resumeFamilyFromNode(data: CreationNodeData): CanvasResumeFamily | null {
  const value = data.resumeFamily;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const family = value as Partial<CanvasResumeFamily>;
  if (family.version !== 1 || typeof family.originalRevisionId !== 'string' || typeof family.activeRevisionId !== 'string'
    || typeof family.masterRevisionId !== 'string' || !Array.isArray(family.revisions) || !family.revisions.length) return null;
  const revisions = family.revisions.filter((revision): revision is CanvasResumeRevision => {
    if (!revision || typeof revision !== 'object') return false;
    const row = revision as Partial<CanvasResumeRevision>;
    return typeof row.id === 'string' && (row.kind === 'original' || row.kind === 'derived')
      && typeof row.title === 'string' && typeof row.markdown === 'string'
      && RESUME_TEMPLATE_IDS.includes(row.templateId as ResumeTemplateId);
  });
  if (!revisions.length || !revisions.some((revision) => revision.id === family.originalRevisionId)) return null;
  const activeRevisionId = revisions.some((revision) => revision.id === family.activeRevisionId) ? family.activeRevisionId : family.originalRevisionId;
  const masterRevisionId = revisions.some((revision) => revision.id === family.masterRevisionId) ? family.masterRevisionId : family.originalRevisionId;
  return { version: 1, originalRevisionId: family.originalRevisionId, activeRevisionId, masterRevisionId, revisions };
}

export function resumeNodePatch(family: CanvasResumeFamily): Partial<CreationNodeData> {
  const active = activeResumeRevision(family);
  return {
    resumeFamily: family,
    markdown: active.markdown,
    content: active.markdown,
    templateId: active.templateId,
  };
}

/**
 * Turn an agent-authored résumé rewrite into a derivative instead of allowing a
 * generic object patch to overwrite the uploaded source. Direct editor changes
 * already operate on an explicit derived revision; this protects the Brain tool
 * path, where the model only sees ordinary `content`/`markdown` fields.
 */
export function preserveResumeSourceForPatch(
  data: CreationNodeData,
  patch: Partial<CreationNodeData>,
  options: { now?: string; idFactory?: () => string } = {},
): Partial<CreationNodeData> {
  if (patch.resumeFamily) return patch;
  const family = resumeFamilyFromNode(data);
  const body = typeof patch.markdown === 'string' ? patch.markdown : typeof patch.content === 'string' ? patch.content : null;
  if (!family || body == null) return patch;
  const title = typeof patch.title === 'string' && patch.title.trim() ? patch.title : data.title;
  let next = deriveResume(family, title, { fromRevisionId: family.originalRevisionId, ...options });
  const requestedTemplate = RESUME_TEMPLATE_IDS.includes(patch.templateId as ResumeTemplateId)
    ? patch.templateId as ResumeTemplateId
    : activeResumeRevision(next).templateId;
  next = updateActiveResume(next, { markdown: body, templateId: requestedTemplate }, options.now);
  return { ...patch, ...resumeNodePatch(next) };
}
