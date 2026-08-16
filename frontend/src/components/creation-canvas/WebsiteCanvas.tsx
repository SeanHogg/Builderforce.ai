/*
 * No `'use client'` here on purpose. Every importer — `CreationNode.tsx` and
 * `CanvasSiteSurface.tsx` — is already inside `CreationCanvas.tsx`'s client boundary, so a
 * directive would mark a second entry point that does not exist, and
 * `check-frontend-architecture` counts directives rather than components.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS } from '@/lib/markdownPipeline';
import styles from './CreationCanvas.module.css';
import { websitePagesFrom, websiteThemeFrom, type WebsiteSection } from './websiteWysiwyg';
import type { CreationNodeData } from './types';

/**
 * The rendered face of a `website` / `prototype` object — its pages, drawn.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────
 * It used to live inside `CreationNode.tsx` because the card was the only place a site
 * was ever drawn. It now has two consumers — the node body and the `site` surface — and a
 * component with two consumers that lives inside one of them is how the two drift: the
 * board's preview and the full-size editor would eventually disagree about which page is
 * active, which is precisely the thing a person switches surfaces to check.
 *
 * So there is ONE renderer, and the surface differs from the card only in the room it is
 * given and the viewport it is asked for. `data-viewport` is the same attribute in both;
 * the stylesheet decides what a phone-width preview looks like, not this component.
 */

/** One section of one page. Kinds are DATA on the section, so a new section kind is an
 *  arm here and nothing else in the canvas learns about it. */
function WebsiteSectionBody({ section, accent }: { section: WebsiteSection; accent: string }) {
  if (section.kind === 'hero') return <section className={styles.wysiwygHero}>
    <div>{section.eyebrow && <small>{section.eyebrow}</small>}<h3>{section.heading}</h3>{section.body && <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS}>{section.body}</ReactMarkdown>}<span>{section.cta && <button style={{ background: accent }}>{section.cta}</button>}{section.secondaryCta && <button className={styles.wysiwygSecondary}>{section.secondaryCta}</button>}</span></div>
    <div className={styles.wysiwygArt} style={{ color: accent }}><i /><i /><i /></div>
  </section>;
  if (section.kind === 'features') return <section className={styles.wysiwygSection}><h4>{section.heading}</h4>{section.body && <p>{section.body}</p>}<div className={styles.wysiwygFeatures}>{section.items?.map((item, index) => <article key={`${item.title}-${index}`}><i style={{ color: accent }}>{String(index + 1).padStart(2, '0')}</i><strong>{item.title}</strong><p>{item.body}</p></article>)}</div></section>;
  if (section.kind === 'stats') return <section className={styles.wysiwygStats}>{section.items?.map((item, index) => <span key={`${item.label}-${index}`}><strong style={{ color: accent }}>{item.value}</strong><small>{item.label}</small></span>)}</section>;
  if (section.kind === 'testimonial') return <section className={styles.wysiwygQuote}><blockquote>“{section.quote || section.body}”</blockquote>{section.author && <cite>{section.author}</cite>}</section>;
  if (section.kind === 'cta') return <section className={styles.wysiwygCta} style={{ background: accent }}><h4>{section.heading}</h4>{section.body && <p>{section.body}</p>}{section.cta && <button>{section.cta}</button>}</section>;
  return <section className={styles.wysiwygSection}><h4>{section.heading}</h4>{section.body && <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS}>{section.body}</ReactMarkdown>}</section>;
}

export interface WebsiteBodyProps {
  data: CreationNodeData;
  onEdit?: (patch: Partial<CreationNodeData>) => void;
  /**
   * Which width the site is drawn at, when the caller owns that choice. Omitted on the
   * board, where the card reads `data.viewport` like every other persisted field — a
   * preview cannot have a viewport control, so it must not have a viewport of its own.
   */
  viewport?: 'desktop' | 'tablet' | 'mobile';
  /**
   * Chrome drawn beside each section — move, duplicate, delete.
   *
   * A render prop rather than a `canEditStructure` flag, because the alternative is
   * this module growing buttons, their labels, their five catalogs and the operation
   * dispatch for a job only ONE of its two consumers has: the card is a preview, and
   * structural editing in ~455px is the cramped-editor problem the `site` surface was
   * created to end. Omitted, the markup is byte-identical to what the board draws.
   */
  sectionControls?: (section: WebsiteSection) => ReactNode;
}

export function WebsiteBody({ data, onEdit, viewport, sectionControls }: WebsiteBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const pages = websitePagesFrom(data);
  const theme = websiteThemeFrom(data);
  const [localPageId, setLocalPageId] = useState(String(data.activeWebsitePageId || pages[0]?.id || ''));
  useEffect(() => { if (data.activeWebsitePageId) setLocalPageId(String(data.activeWebsitePageId)); }, [data.activeWebsitePageId]);
  const activePage = pages.find((page) => page.id === localPageId) || pages[0];
  const accent = theme.accent || 'var(--coral-bright)';
  // The caller's choice wins, then the object's own, then desktop. The surface passes one
  // and the card does not, which is what keeps "preview at phone width" a property of the
  // OBJECT and "look at it at phone width" a property of the person looking.
  const drawnAt = viewport
    ?? (data.viewport === 'mobile' || data.viewport === 'tablet' ? data.viewport : 'desktop');

  if (!activePage) {
    const headline = typeof data.websiteHeadline === 'string' ? data.websiteHeadline : data.title;
    const description = typeof data.websiteBody === 'string' ? data.websiteBody : typeof data.content === 'string' ? data.content : data.subtitle || '';
    const cta = typeof data.websiteCta === 'string' ? data.websiteCta : t('websiteCta');
    return <div className={styles.websitePreview} data-viewport={drawnAt} data-theme="minimal">
      <div className={styles.siteNav}><strong>{data.title}</strong><span /> </div>
      <section className={styles.wysiwygHero}><div><h3>{headline}</h3>{description && <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS}>{description}</ReactMarkdown>}<span><button style={{ background: accent }}>{cta}</button></span></div></section>
    </div>;
  }
  return (
    <div className={styles.websitePreview} data-viewport={drawnAt} data-theme={theme.style} style={{ '--site-bg': theme.background, '--site-fg': theme.foreground } as CSSProperties}>
      <nav className={`${styles.siteNav} nodrag nowheel`}><strong>{data.title}</strong><span>{pages.map((page) => <button key={page.id} type="button" data-active={page.id === activePage.id} onClick={(event) => { event.stopPropagation(); setLocalPageId(page.id); onEdit?.({ activeWebsitePageId: page.id }); }}>{page.name}</button>)}</span>{activePage.sections.find((section) => section.kind === 'hero')?.cta && <button style={{ background: accent }}>{activePage.sections.find((section) => section.kind === 'hero')?.cta}</button>}</nav>
      {activePage.sections.map((section) => (sectionControls
        ? <div key={section.id} className={styles.siteSectionSlot}>
            {sectionControls(section)}
            <WebsiteSectionBody section={section} accent={accent} />
          </div>
        : <WebsiteSectionBody key={section.id} section={section} accent={accent} />))}
    </div>
  );
}
