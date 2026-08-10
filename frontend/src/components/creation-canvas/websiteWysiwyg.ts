import type { CreationNodeData } from './types';

export type WebsiteSectionKind = 'hero' | 'features' | 'content' | 'stats' | 'testimonial' | 'cta';

export type WebsiteSection = {
  id: string;
  kind: WebsiteSectionKind;
  eyebrow?: string;
  heading?: string;
  body?: string;
  cta?: string;
  secondaryCta?: string;
  items?: Array<{ title?: string; body?: string; value?: string; label?: string }>;
  quote?: string;
  author?: string;
};

export type WebsitePage = {
  id: string;
  name: string;
  path: string;
  sections: WebsiteSection[];
};

export type WebsiteTheme = {
  style: 'editorial' | 'bold' | 'minimal' | 'soft' | 'technical';
  background?: string;
  foreground?: string;
  accent?: string;
};

const SECTION_KINDS = new Set<WebsiteSectionKind>(['hero', 'features', 'content', 'stats', 'testimonial', 'cta']);
const THEME_STYLES = new Set<WebsiteTheme['style']>(['editorial', 'bold', 'minimal', 'soft', 'technical']);

function text(value: unknown, max = 2_000): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function slug(value: string, fallback: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized || fallback;
}

function websiteItems(value: unknown): WebsiteSection['items'] {
  if (!Array.isArray(value)) return undefined;
  const items = value.slice(0, 8).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const item = {
      title: text(record.title, 160), body: text(record.body, 600),
      value: text(record.value, 80), label: text(record.label, 160),
    };
    return Object.values(item).some(Boolean) ? [item] : [];
  });
  return items.length ? items : undefined;
}

function websiteSection(value: unknown, index: number): WebsiteSection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!SECTION_KINDS.has(record.kind as WebsiteSectionKind)) return null;
  const kind = record.kind as WebsiteSectionKind;
  const section: WebsiteSection = {
    id: text(record.id, 100) || `${kind}-${index + 1}`,
    kind,
    eyebrow: text(record.eyebrow, 160), heading: text(record.heading, 240), body: text(record.body),
    cta: text(record.cta, 120), secondaryCta: text(record.secondaryCta, 120),
    items: websiteItems(record.items), quote: text(record.quote, 1_000), author: text(record.author, 200),
  };
  const hasContent = Object.entries(section).some(([key, item]) => !['id', 'kind'].includes(key) && item != null);
  return hasContent ? section : null;
}

/** Normalize the authored website contract before it reaches a renderer. */
export function websitePagesFrom(data: Record<string, unknown>): WebsitePage[] {
  if (!Array.isArray(data.pages)) return [];
  return data.pages.slice(0, 8).flatMap((value, pageIndex) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const name = text(record.name, 100);
    const sections = Array.isArray(record.sections)
      ? record.sections.slice(0, 12).map(websiteSection).filter((section): section is WebsiteSection => section != null)
      : [];
    if (!name || !sections.length) return [];
    const id = text(record.id, 100) || slug(name, `page-${pageIndex + 1}`);
    return [{ id, name, path: text(record.path, 160) || (pageIndex === 0 ? '/' : `/${slug(name, id)}`), sections }];
  });
}

export function websiteThemeFrom(data: CreationNodeData): WebsiteTheme {
  const record = data.websiteTheme && typeof data.websiteTheme === 'object' && !Array.isArray(data.websiteTheme)
    ? data.websiteTheme as Record<string, unknown> : {};
  const style = THEME_STYLES.has(record.style as WebsiteTheme['style']) ? record.style as WebsiteTheme['style'] : 'editorial';
  return {
    style,
    background: text(record.background, 32), foreground: text(record.foreground, 32),
    accent: text(record.accent, 32) || text(data.websiteAccent, 32),
  };
}

export function websiteHeroFrom(data: CreationNodeData): { heading: string; body: string; cta: string } {
  const pages = websitePagesFrom(data);
  const page = pages.find((candidate) => candidate.id === data.activeWebsitePageId) || pages[0];
  const hero = page?.sections.find((section) => section.kind === 'hero');
  return {
    heading: hero?.heading || text(data.websiteHeadline, 240) || '',
    body: hero?.body || text(data.websiteBody) || '',
    cta: hero?.cta || text(data.websiteCta, 120) || '',
  };
}

/** AI-created sites must carry a real WYSIWYG experience, not a titled shell. */
export function authoredWebsiteProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Website fields are required.';
  const fields = value as CreationNodeData;
  const pages = websitePagesFrom(fields);
  if (!pages.length) return 'Author fields.pages as WYSIWYG pages with name, path, and renderable sections.';
  const sections = pages.flatMap((page) => page.sections);
  if (!sections.some((section) => section.kind === 'hero' && section.heading && section.body && section.cta)) {
    return 'The WYSIWYG site needs an authored hero section with heading, body, and cta.';
  }
  if (sections.length < 2) return 'The WYSIWYG site needs at least one authored section beyond its hero.';
  return null;
}

/** Keep the simple inspector controls editing the rendered hero, not stale legacy fields. */
export function patchWebsiteHero(data: CreationNodeData, patch: Partial<CreationNodeData>): Partial<CreationNodeData> {
  const pages = websitePagesFrom(data);
  if (!pages.length) return patch;
  const pageIndex = Math.max(0, pages.findIndex((page) => page.id === data.activeWebsitePageId));
  const page = pages[pageIndex] || pages[0]!;
  const heroIndex = page.sections.findIndex((section) => section.kind === 'hero');
  if (heroIndex < 0) return patch;
  const hero = page.sections[heroIndex]!;
  const nextHero = {
    ...hero,
    ...(typeof patch.websiteHeadline === 'string' ? { heading: patch.websiteHeadline } : {}),
    ...(typeof patch.websiteBody === 'string' ? { body: patch.websiteBody } : {}),
    ...(typeof patch.websiteCta === 'string' ? { cta: patch.websiteCta } : {}),
  };
  const nextPages = pages.map((candidate, index) => index === pageIndex
    ? { ...candidate, sections: candidate.sections.map((section, sectionIndex) => sectionIndex === heroIndex ? nextHero : section) }
    : candidate);
  return { ...patch, pages: nextPages };
}
