import type { CreationNodeData } from '@/components/creation-canvas/types';
import {
  DEFAULT_RESUME_TEMPLATE_ID,
  RESUME_TEMPLATE_IDS,
  RESUME_SECTION_ORDER,
  normalizeResumeTemplateId,
  activeResumeRevision,
  createResumeFamily,
  isResumeTemplateId,
  masterResumeRevision,
  projectPublicResumeFamily,
  resumeDocumentFromText,
  resumeFamilyFromValue,
  type CanvasResumeBasics,
  type CanvasResumeDocument,
  type CanvasResumeEducation,
  type CanvasResumeFamily,
  type CanvasResumeLocation,
  type CanvasResumeRevision,
  type CanvasResumeSkill,
  type CanvasResumeWork,
  type ResumeOrientation,
  type ResumePageSize,
  type ResumePreviewMode,
  type ResumePrivacy,
  type ResumeRevisionKind,
  type ResumeSectionId,
  type ResumeTemplateId,
} from '@builderforce/creation-canvas-contract';

/**
 * The résumé DOCUMENT and FAMILY now live in `@builderforce/creation-canvas-contract`,
 * because the server builds and projects them too (for-hire upload, public link, ATS
 * projection). They are re-exported here so this module stays the one import every
 * canvas component already reaches for. What remains local is presentation: template
 * definitions, Markdown rendering and the node adapters.
 */
export {
  RESUME_TEMPLATE_IDS,
  RESUME_SECTION_ORDER,
  activeResumeRevision,
  createResumeFamily,
  isResumeTemplateId,
  masterResumeRevision,
  projectPublicResumeFamily,
  resumeFamilyFromValue,
};
export type {
  CanvasResumeBasics,
  CanvasResumeDocument,
  CanvasResumeEducation,
  CanvasResumeFamily,
  CanvasResumeLocation,
  CanvasResumeRevision,
  CanvasResumeSkill,
  CanvasResumeWork,
  ResumeOrientation,
  ResumePageSize,
  ResumePreviewMode,
  ResumePrivacy,
  ResumeRevisionKind,
  ResumeSectionId,
  ResumeTemplateId,
};

export type ResumeHeadingStyle = 'underlined' | 'divider' | 'caps' | 'plain';
export type ResumeSectionLayout = 'timeline' | 'cards' | 'grid' | 'list' | 'compact';
export type ResumeSortOrder = 'date_desc' | 'date_asc' | 'manual';
export type ResumeHeroLayout = 'split' | 'stacked' | 'compact';
export interface ResumeSectionRule { layout: ResumeSectionLayout; columns?: 1 | 2 | 3 | 4; showHighlights?: boolean; showMedia?: boolean; sortBy?: ResumeSortOrder }

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
  headingStyle: ResumeHeadingStyle;
  industry: string;
  creator?: string;
  firstParty?: boolean;
  sidebar: ResumeSectionId[];
  hero?: { enabled: boolean; layout: ResumeHeroLayout; showAvatar: boolean; showContactButtons: boolean; showSummary: boolean; showVideo: boolean };
  sections?: Partial<Record<ResumeSectionId, ResumeSectionRule>>;
  enabledSections?: ResumeSectionId[];
}

const PRINT_HERO = { enabled: true, layout: 'compact', showAvatar: false, showContactButtons: true, showSummary: true, showVideo: false } as const;
const BASE_SECTIONS: Partial<Record<ResumeSectionId, ResumeSectionRule>> = {
  work: { layout: 'timeline', showHighlights: true, sortBy: 'date_desc' }, education: { layout: 'timeline', sortBy: 'date_desc' }, volunteer: { layout: 'timeline', showHighlights: true, sortBy: 'date_desc' },
  skills: { layout: 'grid', columns: 3 }, languages: { layout: 'grid', columns: 3 }, projects: { layout: 'cards' }, awards: { layout: 'list' }, certificates: { layout: 'list' }, publications: { layout: 'list' }, interests: { layout: 'grid', columns: 3 }, references: { layout: 'list' },
};

const CANONICAL_RESUME_TEMPLATES: readonly ResumeTemplateDefinition[] = [
  { id: 'standard', labelKey: 'template_standard', mode: 'hero', columns: 1, accent: '#7c3aed', paper: '#ffffff', ink: '#172033', font: 'sans', density: 'comfortable', headingStyle: 'plain', industry: 'General', sidebar: [], hero: { enabled: true, layout: 'split', showAvatar: true, showContactButtons: true, showSummary: true, showVideo: true }, sections: BASE_SECTIONS },
  { id: 'payroll-iron-gray', labelKey: 'template_payroll-iron-gray', mode: 'print', columns: 2, accent: '#475569', paper: '#ffffff', ink: '#1e293b', font: 'serif', density: 'compact', headingStyle: 'divider', industry: 'Payroll / Finance', sidebar: ['skills', 'education', 'certificates', 'languages'] },
  { id: 'risk-asphalt', labelKey: 'template_risk-asphalt', mode: 'print', columns: 2, accent: '#27272a', paper: '#ffffff', ink: '#18181b', font: 'sans', density: 'comfortable', headingStyle: 'caps', industry: 'Risk / Consulting', sidebar: ['skills', 'languages', 'certificates'] },
  { id: 'executive-taupe', labelKey: 'template_executive-taupe', mode: 'print', columns: 1, accent: '#78716c', paper: '#ffffff', ink: '#292524', font: 'serif', density: 'spacious', headingStyle: 'divider', industry: 'Executive', sidebar: [] },
  { id: 'intern-education-first', labelKey: 'template_intern-education-first', mode: 'print', columns: 1, accent: '#1d4ed8', paper: '#ffffff', ink: '#172033', font: 'sans', density: 'comfortable', headingStyle: 'underlined', industry: 'New graduate', sidebar: [] },
  { id: 'hospitality-amber', labelKey: 'template_hospitality-amber', mode: 'print', columns: 1, accent: '#b45309', paper: '#ffffff', ink: '#292524', font: 'sans', density: 'comfortable', headingStyle: 'caps', industry: 'Hospitality', sidebar: [] },
  { id: 'creative-minimal', labelKey: 'template_creative-minimal', mode: 'print', columns: 1, accent: '#525252', paper: '#ffffff', ink: '#171717', font: 'mono', density: 'spacious', headingStyle: 'plain', industry: 'Creative', sidebar: [] },
  { id: 'software-engineer-graphite', labelKey: 'template_software-engineer-graphite', mode: 'print', columns: 2, accent: '#047857', paper: '#ffffff', ink: '#172033', font: 'mono', density: 'comfortable', headingStyle: 'plain', industry: 'Software engineering', sidebar: ['skills', 'projects', 'certificates', 'languages'] },
  { id: 'healthcare-clinical-blue', labelKey: 'template_healthcare-clinical-blue', mode: 'print', columns: 2, accent: '#1d4ed8', paper: '#ffffff', ink: '#172033', font: 'sans', density: 'compact', headingStyle: 'underlined', industry: 'Healthcare', sidebar: ['certificates', 'skills', 'education', 'languages'] },
  { id: 'sales-growth-emerald', labelKey: 'template_sales-growth-emerald', mode: 'print', columns: 1, accent: '#047857', paper: '#ffffff', ink: '#172033', font: 'sans', density: 'comfortable', headingStyle: 'caps', industry: 'Sales / Business development', sidebar: [] },
  { id: 'actor-headshot-hero', labelKey: 'template_actor-headshot-hero', mode: 'hero', columns: 1, accent: '#404040', paper: '#ffffff', ink: '#171717', font: 'serif', density: 'compact', headingStyle: 'caps', industry: 'Acting', sidebar: [] },
  { id: 'director-filmography-serif', labelKey: 'template_director-filmography-serif', mode: 'print', columns: 1, accent: '#78716c', paper: '#ffffff', ink: '#292524', font: 'serif', density: 'spacious', headingStyle: 'divider', industry: 'Film directing', sidebar: [] },
] as const;

export const RESUME_TEMPLATES: readonly ResumeTemplateDefinition[] = CANONICAL_RESUME_TEMPLATES.map((template) => ({ ...template, creator: 'Builderforce.ai', firstParty: true }));

export function normalizedResumeTemplate(template: ResumeTemplateDefinition): ResumeTemplateDefinition & { hero: NonNullable<ResumeTemplateDefinition['hero']>; sections: NonNullable<ResumeTemplateDefinition['sections']>; enabledSections: ResumeSectionId[] } {
  const hero = template.hero ?? (template.mode === 'hero'
    ? { enabled: true, layout: 'split' as const, showAvatar: true, showContactButtons: true, showSummary: true, showVideo: true }
    : { ...PRINT_HERO });
  const sections = { ...BASE_SECTIONS, ...(template.sections ?? {}) };
  if (template.id === 'intern-education-first') {
    sections.skills = { layout: 'grid', columns: 2 }; sections.languages = { layout: 'grid', columns: 2 }; sections.interests = { layout: 'grid', columns: 2 };
  }
  if (template.id === 'actor-headshot-hero') sections.projects = { layout: 'list', showHighlights: true, showMedia: true, sortBy: 'date_desc' };
  if (template.id === 'director-filmography-serif') sections.projects = { layout: 'list', showHighlights: true, showMedia: true, sortBy: 'date_desc' };
  const presetSections: Partial<Record<ResumeTemplateId, ResumeSectionId[]>> = {
    'intern-education-first': ['summary', 'education', 'work', 'projects', 'skills', 'volunteer', 'awards', 'languages', 'interests'],
    'actor-headshot-hero': ['summary', 'projects', 'skills', 'languages', 'education', 'awards', 'references'],
    'director-filmography-serif': ['summary', 'projects', 'awards', 'publications', 'work', 'education', 'skills', 'references'],
  };
  const enabledSections = template.enabledSections ?? presetSections[template.id] ?? [...RESUME_SECTION_ORDER];
  return { ...template, hero, sections, enabledSections: hero.showSummary ? enabledSections : enabledSections.filter((id) => id !== 'summary') };
}

type ResumeTemplateDescriptorInput = Partial<ResumeTemplateDefinition> & { version?: unknown; documentMode?: unknown; layout?: unknown; theme?: unknown; hero?: unknown; sections?: unknown };

/** Validate/migrate Hired descriptor v1.0–v1.2 into the Canvas renderer contract. */
export function resumeTemplateFromDescriptor(value: unknown): ResumeTemplateDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as ResumeTemplateDescriptorInput;
  if (!['1.0', '1.1', '1.2'].includes(String(raw.version)) || typeof raw.id !== 'string' || !RESUME_TEMPLATE_IDS.includes(raw.id as ResumeTemplateId)) return null;
  const stock = RESUME_TEMPLATES.find((item) => item.id === raw.id)!;
  const theme = raw.theme && typeof raw.theme === 'object' ? raw.theme as Record<string, unknown> : {};
  const layout = raw.layout && typeof raw.layout === 'object' ? raw.layout as Record<string, unknown> : {};
  const heroRaw = raw.hero && typeof raw.hero === 'object' ? raw.hero as Record<string, unknown> : {};
  const mode = raw.documentMode === 'hero' || raw.documentMode === 'print' ? raw.documentMode : stock.mode;
  const columns = layout.columns === 1 || layout.columns === 2 ? layout.columns : stock.columns;
  const font = ['sans', 'serif', 'mono'].includes(String(theme.fontFamily)) ? theme.fontFamily as ResumeTemplateDefinition['font'] : stock.font;
  const density = ['compact', 'comfortable', 'spacious'].includes(String(theme.density)) ? theme.density as ResumeTemplateDefinition['density'] : stock.density;
  const headingStyle = ['underlined', 'divider', 'caps', 'plain'].includes(String(theme.headingStyle)) ? theme.headingStyle as ResumeHeadingStyle : stock.headingStyle;
  const sectionRules: NonNullable<ResumeTemplateDefinition['sections']> = {};
  const enabledSections: ResumeSectionId[] = [];
  if (Array.isArray(raw.sections)) for (const item of raw.sections) {
    if (!item || typeof item !== 'object' || (item as Record<string, unknown>).kind === 'component') continue;
    const section = item as Record<string, unknown>; const key = String(section.key) as ResumeSectionId;
    if (!RESUME_SECTION_ORDER.includes(key) || section.enabled === false || !['timeline', 'cards', 'grid', 'list', 'compact'].includes(String(section.layout))) continue;
    enabledSections.push(key);
    sectionRules[key] = { layout: section.layout as ResumeSectionLayout,
      ...([1, 2, 3, 4].includes(Number(section.columns)) ? { columns: Number(section.columns) as 1 | 2 | 3 | 4 } : {}),
      ...(typeof section.showHighlights === 'boolean' ? { showHighlights: section.showHighlights } : {}), ...(typeof section.showMedia === 'boolean' ? { showMedia: section.showMedia } : {}),
      ...(['date_desc', 'date_asc', 'manual'].includes(String(section.sortBy)) ? { sortBy: section.sortBy as ResumeSortOrder } : {}),
    };
  }
  const boolean = (key: string, fallback: boolean) => typeof heroRaw[key] === 'boolean' ? heroRaw[key] as boolean : fallback;
  const fallbackHero = normalizedResumeTemplate(stock).hero;
  return { ...stock, mode, columns, font, density, headingStyle,
    sidebar: Array.isArray(layout.sidebar) ? layout.sidebar.filter((item): item is ResumeSectionId => typeof item === 'string' && RESUME_SECTION_ORDER.includes(item as ResumeSectionId)) : stock.sidebar,
    hero: { enabled: boolean('enabled', fallbackHero.enabled), layout: ['split', 'stacked', 'compact'].includes(String(heroRaw.layout)) ? heroRaw.layout as ResumeHeroLayout : fallbackHero.layout, showAvatar: boolean('showAvatar', fallbackHero.showAvatar), showContactButtons: boolean('showContactButtons', fallbackHero.showContactButtons), showSummary: boolean('showSummary', fallbackHero.showSummary), showVideo: boolean('showVideo', fallbackHero.showVideo) },
    sections: Object.keys(sectionRules).length ? sectionRules : normalizedResumeTemplate(stock).sections,
    enabledSections: enabledSections.length ? ['summary', ...enabledSections] : normalizedResumeTemplate(stock).enabledSections,
  };
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** Default revision-id source. Overridable at every call site so tests are reproducible. */
const id = () => crypto.randomUUID();
const stringValue = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];

/**
 * Array sections of the JSON Resume schema. Used to RECOGNISE a résumé export among
 * arbitrary JSON, which is the difference between a file becoming a rendered résumé
 * and becoming a one-row dataset nothing can render (see {@link isJsonResume}).
 */
const JSON_RESUME_SECTIONS = ['work', 'volunteer', 'education', 'awards', 'certificates', 'publications', 'skills', 'languages', 'interests', 'references', 'projects'] as const;

/**
 * Lower-case the first character of every key, at every depth.
 *
 * Hired.VIDEO exports JSON Resume in PascalCase (`Basics.StartDate`) while the schema —
 * and every reader in this file — is camelCase (`basics.startDate`). Without this the
 * document parses, validates as "an object", and then renders BLANK, because not one
 * field name matches. Identity on already-camelCase keys, so it is safe to run on any
 * résumé document from any source rather than guessing which sources need it.
 */
function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key ? `${key[0]!.toLowerCase()}${key.slice(1)}` : key, camelizeKeys(item)]));
}

/**
 * True for a parsed JSON Resume document, in any key casing.
 *
 * `basics` alone is not enough (plenty of API payloads have one), so a document
 * qualifies on an identifiable `basics` object OR on two of the schema's array
 * sections — the combination arbitrary JSON does not have by accident.
 */
export function isJsonResume(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = camelizeKeys(value) as Record<string, unknown>;
  const basics = record.basics;
  const namedBasics = !!basics && typeof basics === 'object' && !Array.isArray(basics)
    && ['name', 'label', 'email', 'summary'].some((field) => typeof (basics as Record<string, unknown>)[field] === 'string');
  const sections = JSON_RESUME_SECTIONS.filter((section) => Array.isArray(record[section])).length;
  return namedBasics || sections >= 2;
}

/**
 * Retain the complete JSON Resume object, including extension fields Hired does not
 * render, normalised to the schema's camelCase key casing.
 */
export function resumeDocumentFromJson(value: unknown): CanvasResumeDocument | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? camelizeKeys(clone(value)) as CanvasResumeDocument
    : null;
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

/**
 * Structure for extracted PDF/Word/text, while retaining its full Markdown.
 *
 * This used to read only a `# name` heading and a `## Summary` block, which meant a
 * résumé held as text — every PDF and Word import — reached {@link resumeDocumentFromNode}
 * with an EMPTY work history. The variant renderer and the candidate screener both read
 * through that accessor, so a real CV restyled into twelve blank templates and screened
 * as "no parsed resume document". The reader that already produced a full document for
 * the upload route now serves this path too; see `resumeDocument.ts` in the contract.
 */
export function resumeDocumentFromMarkdown(markdown: string): CanvasResumeDocument {
  return { ...resumeDocumentFromText(markdown), markdown };
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
  patch: Partial<Pick<CanvasResumeRevision, 'title' | 'markdown' | 'templateId' | 'pageSize' | 'orientation' | 'document' | 'structuredStale'>>,
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

/** Presentation can change on Original without weakening its immutable content contract. */
export function updateActiveResumePresentation(
  family: CanvasResumeFamily,
  patch: Partial<Pick<CanvasResumeRevision, 'templateId' | 'pageSize' | 'orientation'>>,
  now = new Date().toISOString(),
): CanvasResumeFamily {
  const active = activeResumeRevision(family);
  return { ...family, revisions: family.revisions.map((revision) => revision.id === active.id ? { ...revision, ...patch, updatedAt: now } : revision) };
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
  patch: Partial<Pick<CanvasResumeFamily, 'privacy' | 'archivedAt' | 'watched' | 'defaultTemplateId' | 'viewZoom' | 'previewMode'>>,
): CanvasResumeFamily {
  return { ...family, ...patch };
}

/** The source and current master are protected; only ordinary derived revisions can be removed. */
export function deleteResumeRevision(family: CanvasResumeFamily, revisionId: string): CanvasResumeFamily {
  if (revisionId === family.originalRevisionId || revisionId === family.masterRevisionId) return family;
  const removed = family.revisions.find((revision) => revision.id === revisionId);
  if (!removed) return family;
  // Preserve a valid lineage graph when an intermediate revision is removed.
  // Direct descendants inherit its parent rather than retaining a dangling ID.
  const replacementParentId = removed.sourceRevisionId ?? family.originalRevisionId;
  const revisions = family.revisions
    .filter((revision) => revision.id !== revisionId)
    .map((revision) => revision.sourceRevisionId === revisionId
      ? { ...revision, sourceRevisionId: replacementParentId }
      : revision);
  return {
    ...family,
    revisions,
    activeRevisionId: family.activeRevisionId === revisionId ? family.masterRevisionId : family.activeRevisionId,
  };
}

/** Copy one revision into a new independent family whose source is immutable. */
export function detachResumeRevision(
  family: CanvasResumeFamily,
  revisionId: string,
  options: { now?: string; idFactory?: () => string } = {},
): CanvasResumeFamily | null {
  const source = family.revisions.find((revision) => revision.id === revisionId);
  if (!source) return null;
  const now = options.now ?? new Date().toISOString();
  const originalId = (options.idFactory ?? id)();
  const original: CanvasResumeRevision = {
    ...clone(source), id: originalId, kind: 'original', sourceRevisionId: null, createdAt: now, updatedAt: now,
  };
  return {
    version: 1, privacy: 'private', archivedAt: null, watched: false,
    defaultTemplateId: source.templateId, viewZoom: family.viewZoom, previewMode: family.previewMode,
    originalRevisionId: originalId, activeRevisionId: originalId, masterRevisionId: originalId, revisions: [original],
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
      && normalizeResumeTemplateId(row.templateId) !== null;
  }).map((revision) => ({ ...revision,
    templateId: normalizeResumeTemplateId(revision.templateId)!,
    pageSize: ['letter', 'legal', 'a4'].includes(String(revision.pageSize)) ? revision.pageSize : 'a4',
    orientation: ['portrait', 'landscape'].includes(String(revision.orientation)) ? revision.orientation : 'portrait',
  }));
  if (!revisions.length || !revisions.some((revision) => revision.id === family.originalRevisionId)) return null;
  const activeRevisionId = revisions.some((revision) => revision.id === family.activeRevisionId) ? family.activeRevisionId : family.originalRevisionId;
  const masterRevisionId = revisions.some((revision) => revision.id === family.masterRevisionId) ? family.masterRevisionId : family.originalRevisionId;
  const privacy = ['public', 'recruiter_only', 'connections', 'private', 'draft'].includes(String(family.privacy))
    ? family.privacy as CanvasResumeFamily['privacy'] : 'private';
  return {
    version: 1, privacy, archivedAt: typeof family.archivedAt === 'string' ? family.archivedAt : null,
    watched: family.watched === true,
    defaultTemplateId: normalizeResumeTemplateId(family.defaultTemplateId) ?? DEFAULT_RESUME_TEMPLATE_ID,
    viewZoom: typeof family.viewZoom === 'number' && family.viewZoom >= 40 && family.viewZoom <= 125 ? family.viewZoom : 75,
    previewMode: ['continuous', 'paged', 'spread'].includes(String(family.previewMode)) ? family.previewMode as ResumePreviewMode : 'continuous',
    originalRevisionId: family.originalRevisionId, activeRevisionId, masterRevisionId, revisions,
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
    ...resumeNodePatch(createResumeFamily({
      title,
      markdown,
      ...(document ? { document } : {}),
      ...(RESUME_TEMPLATE_IDS.includes(patch.templateId as ResumeTemplateId) ? { templateId: patch.templateId as ResumeTemplateId } : {}),
    })),
  };
}

/**
 * THE TEMPLATE ENGINE FAN-OUT: one résumé document, N presentations of it.
 *
 * Producing "ten versions in different styles" by asking a model to author ten
 * résumés is the expensive way to get the wrong thing — ten separate generations,
 * each free to drift from the person's actual history, and (measured 2026-08-15) a
 * turn that stalled without finishing one. The content is already settled; only the
 * PRESENTATION varies, and presentation is what {@link RESUME_TEMPLATES} describes.
 * So the fan-out is a pure function over the document: no model, no round-trip, no
 * opportunity to invent a job the person never had.
 */
export function resumeTemplateVariants(
  document: CanvasResumeDocument,
  templateIds: readonly ResumeTemplateId[],
  options: { title?: string; now?: string; idFactory?: () => string } = {},
): Array<{ templateId: ResumeTemplateId; industry: string; family: CanvasResumeFamily }> {
  const markdown = renderResumeMarkdown(document);
  const name = stringValue(options.title ?? document.basics?.name);
  return templateIds.map((templateId) => {
    const template = RESUME_TEMPLATES.find((item) => item.id === templateId) ?? RESUME_TEMPLATES[0]!;
    return {
      templateId: template.id,
      industry: template.industry,
      family: createResumeFamily({
        title: name ? `${name} — ${template.industry}` : template.industry,
        markdown,
        document,
        templateId: template.id,
        ...(options.now ? { now: options.now } : {}),
        ...(options.idFactory ? { idFactory: options.idFactory } : {}),
      }),
    };
  });
}

/**
 * The résumé document a canvas object holds, whatever kind of object it is.
 *
 * A JSON Resume file imported before {@link isJsonResume} existed is still sitting on
 * boards as a one-row Dataset whose cells are JSON strings, so the fan-out reads BOTH
 * shapes: it must work on the résumé the user already has, not only on one imported
 * after this change.
 */
export function resumeDocumentFromNode(data: CreationNodeData): CanvasResumeDocument | null {
  const family = resumeFamilyFromNode(data);
  const revision = family ? activeResumeRevision(family) : null;
  if (revision?.document) return clone(revision.document);
  if (revision?.markdown.trim()) return resumeDocumentFromMarkdown(revision.markdown);
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const row = rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  // Dataset cells are stringified by the tabular importer; a section that survived as
  // a real value is kept as-is rather than round-tripped through a failed parse.
  const revived = Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, cell]) => {
    if (typeof cell !== 'string' || !/^\s*[[{]/.test(cell)) return [key, cell];
    try { return [key, JSON.parse(cell) as unknown]; } catch { return [key, cell]; }
  }));
  return isJsonResume(revived) ? resumeDocumentFromJson(revived) : null;
}
