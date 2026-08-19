/*
 * No `'use client'` here on purpose. Every importer — `CreationNode.tsx` and
 * `CanvasSiteSurface.tsx` — is already inside `CreationCanvas.tsx`'s client boundary, so a
 * directive would mark a second entry point that does not exist, and
 * `check-frontend-architecture` counts directives rather than components.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS } from '@/lib/markdownPipeline';
import type { CanvasViewport } from '@/lib/canvasViewport';
import {
  CANVAS_WEBSITE_FRAME_SANDBOX,
  canvasWebsiteDocument,
  canvasWebsitePageMessage,
} from '@/lib/canvasWebsite';
import { CanvasDeviceFrame } from './CanvasDeviceFrame';
import styles from './CreationCanvas.module.css';
import {
  WEBSITE_CONTENT_FRAME_SANDBOX,
  isMarkupSectionBody,
  websitePagesFrom,
  websiteThemeFrom,
  type WebsiteSection,
} from './websiteWysiwyg';
import type { CreationNodeData } from './types';

/**
 * The AUTHORING face of a `website` / `prototype` object — its pages, drawn as editable
 * React so a section can be retitled, moved, duplicated and deleted in place.
 *
 * ── THIS IS NO LONGER THE PREVIEW ────────────────────────────────────────────────
 * It used to be both, and being both was the bug. Rendered into the board's own DOM it
 * inherits the board: `var(--canvas-line)`, `var(--surface)`, the app's fonts and the
 * app's light/dark theme — so an author checking their landing page saw it repainted by a
 * theme toggle their visitors will never touch. And because a card is 455px wide, this
 * renderer's type scale is 6–9px and its sections are approximations: a decorative block
 * where the hero artwork goes, a heading and one line of prose where the real document
 * lays out a features grid, a stats band or an embedded form.
 *
 * `WebsiteFrame` below is the preview now — the SAME document the publisher serves, in a
 * frame nothing outside can style. This stays as the thing you edit in, which is the one
 * job a frame genuinely cannot do.
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
  const t = useTranslations('creationCanvas.node');
  if (isMarkupSectionBody(section)) return <section className={styles.wysiwygSection}>
    {section.heading && <h4>{section.heading}</h4>}
    <iframe
      className={`${styles.wysiwygMarkupFrame} nodrag nowheel`}
      title={section.heading || t('websiteMarkupFrameTitle')}
      sandbox={WEBSITE_CONTENT_FRAME_SANDBOX}
      srcDoc={section.body}
    />
  </section>;
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
  viewport?: CanvasViewport;
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

export interface WebsiteFrameProps {
  data: CreationNodeData;
  /** Which width the reader is checking. The card passes the object's own; the surface
   *  passes the reader's choice — see `CanvasSiteSurface` for why those differ. */
  viewport: CanvasViewport;
  /** Pinned, never `'auto'`: a preview that followed the reader's OS or the board's theme
   *  is the leak this component exists to stop. The surface offers the author a switch. */
  colorScheme: 'light' | 'dark';
  /** Absent on a board the viewer cannot drive — the page nav then reads without writing. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
  className?: string;
}

/**
 * The site as its visitors get it: the SAME self-contained document the publisher serves,
 * framed at a real device width with no origin of its own.
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────────
 * Three things at once, all of them one root cause — the board was drawing its own
 * approximation of a page it already knew how to render properly.
 *   · The full site renders. Every section the document lays out — the features grid, the
 *     stats band, the embedded markup block, the real type scale — instead of a heading
 *     and a line of prose at 7px.
 *   · Nothing outside can style it. A frame has its own cascade, so `var(--canvas-line)`,
 *     the app's fonts and the operator's dark-mode toggle stop at its edge.
 *   · The width means something. `CanvasDeviceFrame` lays it out at 1280 / 834 / 390 and
 *     scales the result, so the page's own media queries fire for the device chosen.
 *
 * ── WHY IT FALLS BACK RATHER THAN FRAMING NOTHING ────────────────────────────────
 * A site the author has only named holds no page yet, and `renderWebsiteDocument` refuses
 * to invent an empty shell for one. Framing that would replace a legible "here is your
 * headline" with a blank white rectangle, so the unauthored case stays with the editor.
 */
export function WebsiteFrame({ data, viewport, colorScheme, onEdit, className }: WebsiteFrameProps) {
  const t = useTranslations('creationCanvas.node');
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Memoised because a board re-renders its nodes on every pan, selection and hover, and
  // rebuilding the document each time would re-serialise every page and section of every
  // site on the board for a string that only changes when the OBJECT does.
  const reportPageChanges = !!onEdit;
  const document = useMemo(
    () => canvasWebsiteDocument(data, { colorScheme, reportPageChanges }),
    [data, colorScheme, reportPageChanges],
  );

  // The page nav the reader clicks lives INSIDE the frame, so this is how the board hears
  // about it. Held in a ref because `onEdit` is a fresh closure on every parent render and
  // a dependency on it would tear the listener down and rebuild it each time.
  const live = useRef(onEdit);
  live.current = onEdit;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Scoped to THIS frame: several website cards on one board all listen on the same
      // window, and without the check each would act on the others' page switches.
      if (event.source !== frameRef.current?.contentWindow) return;
      const pageId = canvasWebsitePageMessage(event.data);
      if (pageId) live.current?.({ activeWebsitePageId: pageId });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!document) {
    return <WebsiteBody data={data} viewport={viewport} {...(onEdit ? { onEdit } : {})} />;
  }
  return <CanvasDeviceFrame
    frameRef={frameRef}
    viewport={viewport}
    srcDoc={document}
    title={t('websiteFrameTitle', { title: data.title })}
    // No `allow-same-origin` — see `CANVAS_WEBSITE_FRAME_SANDBOX`.
    sandbox={CANVAS_WEBSITE_FRAME_SANDBOX}
    frameClassName="nodrag nowheel"
    {...(className ? { className } : {})}
  />;
}
