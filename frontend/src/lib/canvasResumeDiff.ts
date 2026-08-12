import {
  activeResumeRevision,
  deriveResume,
  renderResumeMarkdown,
  type CanvasResumeDocument,
  type CanvasResumeFamily,
  type CanvasResumeRevision,
  type ResumeSectionId,
} from './canvasResume';

export const RESUME_DIFF_SECTIONS = ['basics', 'work', 'education', 'skills', 'volunteer', 'projects', 'awards', 'certificates', 'publications', 'languages', 'interests', 'references'] as const;
export type ResumeDiffSection = (typeof RESUME_DIFF_SECTIONS)[number];

export interface ResumeFieldDifference {
  path: string;
  source: unknown;
  target: unknown;
}

export interface ResumeSectionDifference {
  section: ResumeDiffSection;
  changed: boolean;
  sourceCount: number;
  targetCount: number;
  fields: ResumeFieldDifference[];
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalized(item)]));
  return value ?? null;
}
const stable = (value: unknown): string => JSON.stringify(normalized(value));
const count = (value: unknown): number => Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value as Record<string, unknown>).filter((key) => (value as Record<string, unknown>)[key] != null && (value as Record<string, unknown>)[key] !== '').length : value == null || value === '' ? 0 : 1;

function scalarFields(section: ResumeDiffSection, source: unknown, target: unknown): ResumeFieldDifference[] {
  if (!source || typeof source !== 'object' || Array.isArray(source) || !target || typeof target !== 'object' || Array.isArray(target)) return [];
  const sourceRow = source as Record<string, unknown>;
  const targetRow = target as Record<string, unknown>;
  return [...new Set([...Object.keys(sourceRow), ...Object.keys(targetRow)])]
    .filter((key) => stable(sourceRow[key]) !== stable(targetRow[key]))
    .map((key) => ({ path: `${section}.${key}`, source: sourceRow[key], target: targetRow[key] }));
}

/** Canonical, deterministic comparison used by both the compare UI and merge preview. */
export function compareResumeDocuments(source: CanvasResumeDocument, target: CanvasResumeDocument): ResumeSectionDifference[] {
  return RESUME_DIFF_SECTIONS.map((section) => {
    const sourceValue = source[section];
    const targetValue = target[section];
    return {
      section,
      changed: stable(sourceValue) !== stable(targetValue),
      sourceCount: count(sourceValue),
      targetCount: count(targetValue),
      fields: section === 'basics' ? scalarFields(section, sourceValue, targetValue) : [],
    };
  });
}

/** Copy selected canonical sections from source into target, retaining extension fields. */
export function mergeResumeDocuments(
  target: CanvasResumeDocument,
  source: CanvasResumeDocument,
  takeFromSource: ReadonlySet<ResumeDiffSection>,
): CanvasResumeDocument {
  const merged: CanvasResumeDocument = structuredClone(target);
  for (const section of takeFromSource) {
    if (source[section] === undefined) delete merged[section];
    else merged[section] = structuredClone(source[section]) as never;
  }
  return merged;
}

/** Execute a merge as a new head. Neither input revision is mutated. */
export function mergeResumeAsNewVersion(
  family: CanvasResumeFamily,
  sourceRevision: CanvasResumeRevision,
  targetRevision: CanvasResumeRevision,
  takeFromSource: ReadonlySet<ResumeDiffSection>,
  title: string,
  options: { now?: string; idFactory?: () => string } = {},
): CanvasResumeFamily {
  if (!sourceRevision.document || !targetRevision.document) return family;
  const document = mergeResumeDocuments(targetRevision.document, sourceRevision.document, takeFromSource);
  let next = deriveResume(family, title, { fromRevisionId: targetRevision.id, ...options });
  const active = activeResumeRevision(next);
  next = {
    ...next,
    revisions: next.revisions.map((revision) => revision.id === active.id ? {
      ...revision,
      document,
      markdown: renderResumeMarkdown(document),
      structuredStale: false,
      updatedAt: options.now ?? revision.updatedAt,
    } : revision),
  };
  return next;
}

export const resumeSectionIdForDiff = (section: ResumeDiffSection): ResumeSectionId | null => section === 'basics' ? null : section;
