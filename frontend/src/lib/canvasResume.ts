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

export interface CanvasResumeLocation extends Record<string, unknown> {
  address?: string; postalCode?: string; city?: string; countryCode?: string; region?: string;
}
export interface CanvasResumeBasics extends Record<string, unknown> {
  name?: string; label?: string; image?: string; email?: string; phone?: string; url?: string; summary?: string; location?: CanvasResumeLocation | null;
}
export interface CanvasResumeWork extends Record<string, unknown> {
  id?: string; name?: string; position?: string; url?: string; summary?: string; startDate?: string; endDate?: string;
  locationType?: string; employmentType?: string; highlights?: string[];
}
export interface CanvasResumeEducation extends Record<string, unknown> {
  id?: string; institution?: string; area?: string; studyType?: string; startDate?: string; endDate?: string; score?: string; url?: string; courses?: string[];
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

export const RESUME_SECTION_ORDER = ['summary', 'work', 'education', 'skills', 'volunteer', 'projects', 'awards', 'certificates', 'publications', 'languages', 'interests', 'references'] as const;
export type ResumeSectionId = (typeof RESUME_SECTION_ORDER)[number];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const stringValue = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];

/** Retain the complete JSON Resume object, including extension fields Hired does not render. */
export function resumeDocumentFromJson(value: unknown): CanvasResumeDocument | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? clone(value as CanvasResumeDocument) : null;
}

function dateRange(row: Record<string, unknown>): string {
  const start = stringValue(row.startDate);
  const end = stringValue(row.endDate);
  return start ? `${start} – ${end || 'Present'}` : '';
}

/** Canonical JSON Resume → Markdown projection shared by preview, edit, and export. */
export function renderResumeMarkdown(document: CanvasResumeDocument): string {
  const lines: string[] = [];
  const basics = document.basics ?? {};
  const name = stringValue(basics.name);
  if (name) lines.push(`# ${name}`);
  if (stringValue(basics.label)) lines.push(`*${stringValue(basics.label)}*`);
  const location = basics.location && typeof basics.location === 'object'
    ? [basics.location.city, basics.location.region, basics.location.countryCode].map(stringValue).filter(Boolean).join(', ')
    : '';
  const contact = [basics.email, basics.phone, basics.url, location].map(stringValue).filter(Boolean);
  if (contact.length) lines.push(contact.join(' · '));
  const sectionChunks = new Map<string, string[]>();
  if (stringValue(basics.summary)) sectionChunks.set('summary', ['## Summary', stringValue(basics.summary)]);

  const addEntries = (id: ResumeSectionId, heading: string, rows: unknown, render: (row: Record<string, unknown>) => string[]) => {
    if (!Array.isArray(rows) || !rows.length) return;
    const rendered = rows.flatMap((row) => row && typeof row === 'object' && !Array.isArray(row) ? render(row as Record<string, unknown>) : []);
    if (rendered.length) sectionChunks.set(id, [`## ${heading}`, ...rendered]);
  };
  addEntries('work', 'Experience', document.work, (row) => {
    const heading = [stringValue(row.position), stringValue(row.name)].filter(Boolean).join(' — ');
    return [heading ? `### ${heading}` : '', dateRange(row) ? `*${dateRange(row)}*` : '', stringValue(row.summary), ...stringArray(row.highlights).map((item) => `- ${item}`), ''].filter((item, index, rows) => item || index === rows.length - 1);
  });
  addEntries('education', 'Education', document.education, (row) => {
    const heading = [stringValue(row.institution), stringValue(row.studyType), stringValue(row.area)].filter(Boolean).join(' — ');
    return [heading ? `### ${heading}` : '', dateRange(row) ? `*${dateRange(row)}*` : '', stringValue(row.score) ? `Score: ${stringValue(row.score)}` : '', ...stringArray(row.courses).map((item) => `- ${item}`), ''].filter((item, index, rows) => item || index === rows.length - 1);
  });
  addEntries('skills', 'Skills', document.skills, (row) => {
    const keywords = stringArray(row.keywords);
    const label = stringValue(row.name);
    return [label && keywords.length ? `- **${label}**: ${keywords.join(', ')}` : label ? `- ${label}` : keywords.length ? `- ${keywords.join(', ')}` : ''].filter(Boolean);
  });
  addEntries('projects', 'Projects', document.projects, (row) => [
    `### ${stringValue(row.name)}`,
    [stringValue(row.entity), stringValue(row.type), dateRange(row)].filter(Boolean).join(' · '),
    stringValue(row.description),
    ...stringArray(row.roles).map((item) => `- ${item}`),
    ...stringArray(row.highlights).map((item) => `- ${item}`),
    ...(stringArray(row.keywords).length ? [`*${stringArray(row.keywords).join(' · ')}*`] : []),
    '',
  ].filter(Boolean));
  addEntries('volunteer', 'Volunteer', document.volunteer, (row) => [`### ${[stringValue(row.position), stringValue(row.organization)].filter(Boolean).join(' — ')}`, dateRange(row) ? `*${dateRange(row)}*` : '', stringValue(row.summary), ...stringArray(row.highlights).map((item) => `- ${item}`), ''].filter(Boolean));
  addEntries('certificates', 'Certifications', document.certificates, (row) => [`- ${[stringValue(row.name), stringValue(row.issuer), stringValue(row.date)].filter(Boolean).join(' — ')}`]);
  addEntries('awards', 'Awards', document.awards, (row) => [`- ${[stringValue(row.title), stringValue(row.awarder), stringValue(row.date)].filter(Boolean).join(' — ')}`, stringValue(row.summary)].filter(Boolean));
  addEntries('publications', 'Publications', document.publications, (row) => [`- ${[stringValue(row.name), stringValue(row.publisher), stringValue(row.releaseDate)].filter(Boolean).join(' — ')}`, stringValue(row.summary)].filter(Boolean));
  addEntries('languages', 'Languages', document.languages, (row) => [`- ${[stringValue(row.language), stringValue(row.fluency)].filter(Boolean).join(' — ')}`]);
  addEntries('interests', 'Interests', document.interests, (row) => {
    const keywords = stringArray(row.keywords);
    return [`- ${stringValue(row.name)}${keywords.length ? `: ${keywords.join(', ')}` : ''}`];
  });
  addEntries('references', 'References', document.references, (row) => [`### ${stringValue(row.name)}`, stringValue(row.reference), ''].filter(Boolean));
  const configured = Array.isArray(document.builderforceLayout?.sectionOrder) ? document.builderforceLayout.sectionOrder : [];
  const order = [...configured.filter((id): id is ResumeSectionId => RESUME_SECTION_ORDER.includes(id as ResumeSectionId)), ...RESUME_SECTION_ORDER].filter((id, index, all) => all.indexOf(id) === index);
  const hidden = new Set(document.builderforceLayout?.hiddenSections ?? []);
  for (const id of order) {
    const chunk = sectionChunks.get(id);
    if (chunk?.length && !hidden.has(id)) lines.push('', ...chunk);
  }
  while (lines.length && !lines.at(-1)?.trim()) lines.pop();
  return lines.join('\n');
}

/** Best-effort structure for extracted PDF/Word/text while retaining its full Markdown. */
export function resumeDocumentFromMarkdown(markdown: string): CanvasResumeDocument {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const name = stringValue(lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, ''));
  const summaryStart = lines.findIndex((line) => /^##\s+summary\s*$/i.test(line));
  const nextHeading = summaryStart >= 0 ? lines.findIndex((line, index) => index > summaryStart && /^##\s+/.test(line)) : -1;
  const summary = summaryStart >= 0 ? lines.slice(summaryStart + 1, nextHeading >= 0 ? nextHeading : undefined).join('\n').trim() : '';
  return { basics: { name, summary }, markdown };
}

export type ResumeRevisionKind = 'original' | 'derived';

export interface CanvasResumeRevision {
  id: string;
  kind: ResumeRevisionKind;
  title: string;
  markdown: string;
  document?: CanvasResumeDocument;
  structuredStale?: boolean;
  templateId: ResumeTemplateId;
  sourceRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasResumeFamily {
  version: 1;
  privacy: 'public' | 'recruiter_only' | 'connections' | 'private' | 'draft';
  archivedAt: string | null;
  watched: boolean;
  originalRevisionId: string;
  activeRevisionId: string;
  masterRevisionId: string;
  revisions: CanvasResumeRevision[];
}

const id = () => crypto.randomUUID();

export function createResumeFamily(args: { title: string; markdown: string; document?: CanvasResumeDocument; now?: string; idFactory?: () => string }): CanvasResumeFamily {
  const now = args.now ?? new Date().toISOString();
  const revisionId = (args.idFactory ?? id)();
  const original: CanvasResumeRevision = {
    id: revisionId,
    kind: 'original',
    title: args.title.trim(),
    markdown: args.markdown.trim(),
    ...(args.document ? { document: clone(args.document), structuredStale: false } : {}),
    templateId: 'hired-default',
    sourceRevisionId: null,
    createdAt: now,
    updatedAt: now,
  };
  return { version: 1, privacy: 'private', archivedAt: null, watched: false, originalRevisionId: revisionId, activeRevisionId: revisionId, masterRevisionId: revisionId, revisions: [original] };
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
  patch: Partial<Pick<CanvasResumeRevision, 'title' | 'markdown' | 'templateId' | 'document' | 'structuredStale'>>,
  now = new Date().toISOString(),
): CanvasResumeFamily {
  const active = activeResumeRevision(family);
  if (active.kind === 'original') return family;
  return {
    ...family,
    revisions: family.revisions.map((revision) => revision.id === active.id
      ? {
        ...revision,
        ...patch,
        ...(patch.document ? { document: clone(patch.document), markdown: renderResumeMarkdown(patch.document), structuredStale: false } : {}),
        updatedAt: now,
      }
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

export function updateResumeFamilySettings(
  family: CanvasResumeFamily,
  patch: Partial<Pick<CanvasResumeFamily, 'privacy' | 'archivedAt' | 'watched'>>,
): CanvasResumeFamily {
  return { ...family, ...patch };
}

/** The source and current master are protected; only ordinary derived revisions can be removed. */
export function deleteResumeRevision(family: CanvasResumeFamily, revisionId: string): CanvasResumeFamily {
  if (revisionId === family.originalRevisionId || revisionId === family.masterRevisionId) return family;
  if (!family.revisions.some((revision) => revision.id === revisionId)) return family;
  const revisions = family.revisions.filter((revision) => revision.id !== revisionId);
  return {
    ...family,
    revisions,
    activeRevisionId: family.activeRevisionId === revisionId ? family.masterRevisionId : family.activeRevisionId,
  };
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
  const privacy = ['public', 'recruiter_only', 'connections', 'private', 'draft'].includes(String(family.privacy))
    ? family.privacy as CanvasResumeFamily['privacy'] : 'private';
  return {
    version: 1, privacy, archivedAt: typeof family.archivedAt === 'string' ? family.archivedAt : null,
    watched: family.watched === true, originalRevisionId: family.originalRevisionId, activeRevisionId, masterRevisionId, revisions,
  };
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
  const requestedDocument = resumeDocumentFromJson(patch.resumeDocument);
  const body = requestedDocument ? renderResumeMarkdown(requestedDocument)
    : typeof patch.markdown === 'string' ? patch.markdown
      : typeof patch.content === 'string' ? patch.content : null;
  if (!family || body == null) return patch;
  const title = typeof patch.title === 'string' && patch.title.trim() ? patch.title : data.title;
  let next = deriveResume(family, title, { fromRevisionId: family.originalRevisionId, ...options });
  const requestedTemplate = RESUME_TEMPLATE_IDS.includes(patch.templateId as ResumeTemplateId)
    ? patch.templateId as ResumeTemplateId
    : activeResumeRevision(next).templateId;
  next = updateActiveResume(next, requestedDocument
    ? { document: requestedDocument, templateId: requestedTemplate }
    : { markdown: body, templateId: requestedTemplate, structuredStale: !!activeResumeRevision(next).document }, options.now);
  const persistedPatch = { ...patch };
  delete persistedPatch.resumeDocument;
  return { ...persistedPatch, ...resumeNodePatch(next) };
}

/** Materialize a newly agent-authored resume into the same family shape uploads use. */
export function initializeResumeFromPatch(title: string, patch: Partial<CreationNodeData>): Partial<CreationNodeData> {
  const document = resumeDocumentFromJson(patch.resumeDocument);
  const markdown = document ? renderResumeMarkdown(document)
    : typeof patch.markdown === 'string' ? patch.markdown
      : typeof patch.content === 'string' ? patch.content : '';
  if (!markdown.trim()) return patch;
  const persistedPatch = { ...patch };
  delete persistedPatch.resumeDocument;
  return {
    ...persistedPatch,
    ...resumeNodePatch(createResumeFamily({ title, markdown, ...(document ? { document } : {}) })),
  };
}
