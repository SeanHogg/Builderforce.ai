/**
 * Render an authored website to ONE self-contained, framework-free HTML document.
 *
 * ── WHY THIS IS SHARED AND NOT RESTATED PER CALLER ───────────────────────────────
 * Two callers need the exact same string with different framing around it: the site
 * publisher (`siteLandingPage.ts`, a Worker with no React) wraps it with a door back
 * into the signed-in app, and the canvas `app` surface (`canvasApp.ts`, a browser lib
 * with no server) wraps a `website` object's pages in with any `code` objects on the
 * same board so the two run as one preview. Both need the SAME sections rendered the
 * SAME way — a section kind one of them forgets is a page the other one shows and this
 * one silently drops. So the pixels live here once; each caller supplies only what
 * differs (whether there is a door back to the app, and what to call it).
 */

import { WEBSITE_CONTENT_FRAME_SANDBOX, activeWebsitePage, isMarkupSectionBody } from './website';
import type { WebsitePage, WebsiteSection, WebsiteTheme } from './website';

interface Palette { bg: string; fg: string; muted: string; accent: string; onAccent: string; line: string; panel: string }

/**
 * A palette per theme style, plus its dark counterpart.
 *
 * The creator's own `background` / `foreground` / `accent` override these when set —
 * this is what a page looks like when they have said nothing. Both modes are defined
 * for every style, because the document is served to strangers on their own devices
 * and half of them are in dark mode.
 */
const PALETTES: Record<WebsiteTheme['style'], { light: Palette; dark: Palette }> = {
  editorial: {
    light: { bg: '#fbfaf7', fg: '#1a1917', muted: '#5c5850', accent: '#8c3b20', onAccent: '#ffffff', line: '#e3ded2', panel: '#ffffff' },
    dark: { bg: '#14130f', fg: '#f2efe8', muted: '#a8a296', accent: '#e0805e', onAccent: '#14130f', line: '#2c2924', panel: '#1c1a16' },
  },
  bold: {
    light: { bg: '#ffffff', fg: '#0a0a0a', muted: '#525252', accent: '#1d4ed8', onAccent: '#ffffff', line: '#e5e5e5', panel: '#f5f5f5' },
    dark: { bg: '#0a0a0a', fg: '#fafafa', muted: '#a3a3a3', accent: '#7aa2ff', onAccent: '#0a0a0a', line: '#262626', panel: '#161616' },
  },
  minimal: {
    light: { bg: '#ffffff', fg: '#18181b', muted: '#71717a', accent: '#18181b', onAccent: '#ffffff', line: '#e4e4e7', panel: '#fafafa' },
    dark: { bg: '#101012', fg: '#f4f4f5', muted: '#a1a1aa', accent: '#f4f4f5', onAccent: '#101012', line: '#27272a', panel: '#18181b' },
  },
  soft: {
    light: { bg: '#fdf8f4', fg: '#2b211c', muted: '#6d5d54', accent: '#c2643c', onAccent: '#ffffff', line: '#ecdfd5', panel: '#ffffff' },
    dark: { bg: '#171210', fg: '#f5ece6', muted: '#ab9a90', accent: '#e8916a', onAccent: '#171210', line: '#2e2521', panel: '#1f1815' },
  },
  technical: {
    light: { bg: '#f7f8fa', fg: '#0f172a', muted: '#556076', accent: '#0f766e', onAccent: '#ffffff', line: '#dfe3ea', panel: '#ffffff' },
    dark: { bg: '#0b0f16', fg: '#e6edf6', muted: '#93a1b5', accent: '#3fd0c3', onAccent: '#0b0f16', line: '#1d2532', panel: '#131924' },
  },
};

/** A creator-supplied colour, only when it is one we can safely inline. */
function safeColor(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^#[0-9a-f]{3,8}$/i.test(trimmed) || /^[a-z]{3,20}$/i.test(trimmed) ? trimmed : null;
}

function paletteFor(theme: WebsiteTheme, mode: 'light' | 'dark'): Palette {
  const base = PALETTES[theme.style][mode];
  // An authored colour is the author's decision in BOTH modes: a creator who picked
  // their brand blue did not pick a different blue for dark mode, and silently
  // substituting one would render their page in colours they never chose.
  return {
    ...base,
    ...(safeColor(theme.background) ? { bg: safeColor(theme.background)! } : {}),
    ...(safeColor(theme.foreground) ? { fg: safeColor(theme.foreground)! } : {}),
    ...(safeColor(theme.accent) ? { accent: safeColor(theme.accent)! } : {}),
  };
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape for text and attribute positions alike. Everything in this document comes
 *  from creator-authored fields, so nothing is exempt. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function cssVars(palette: Palette): string {
  return Object.entries(palette).map(([key, value]) => `--${key}:${value}`).join(';');
}

function renderItems(section: WebsiteSection, kind: 'features' | 'stats'): string {
  if (!section.items?.length) return '';
  const cells = section.items.map((item) => (kind === 'stats'
    ? `<li><b>${escapeHtml(item.value ?? item.title ?? '')}</b><span>${escapeHtml(item.label ?? item.body ?? '')}</span></li>`
    : `<li><h3>${escapeHtml(item.title ?? '')}</h3><p>${escapeHtml(item.body ?? '')}</p></li>`)).join('');
  return `<ul class="${kind}">${cells}</ul>`;
}

/** One section. The switch is total over the contract's declared vocabulary — a kind
 *  the contract adds and this does not handle is a compile error, not a blank block. */
function renderSection(section: WebsiteSection, ctaHref: string | null): string {
  const eyebrow = section.eyebrow ? `<p class="eyebrow">${escapeHtml(section.eyebrow)}</p>` : '';
  const heading = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : '';
  const body = section.body ? `<p class="body">${escapeHtml(section.body)}</p>` : '';
  const cta = section.cta && ctaHref
    ? `<p class="actions"><a class="cta" href="${escapeHtml(ctaHref)}">${escapeHtml(section.cta)}</a>${
      section.secondaryCta ? `<span class="cta2">${escapeHtml(section.secondaryCta)}</span>` : ''}</p>`
    : '';

  switch (section.kind) {
    case 'hero':
      return `<section class="s hero">${eyebrow}${section.heading ? `<h1>${escapeHtml(section.heading)}</h1>` : ''}${body}${cta}</section>`;
    case 'features':
      return `<section class="s">${eyebrow}${heading}${body}${renderItems(section, 'features')}${cta}</section>`;
    case 'stats':
      return `<section class="s">${eyebrow}${heading}${renderItems(section, 'stats')}</section>`;
    case 'testimonial':
      return `<section class="s quote"><blockquote>${escapeHtml(section.quote ?? '')}</blockquote>${
        section.author ? `<cite>${escapeHtml(section.author)}</cite>` : ''}</section>`;
    case 'content':
      // A model-authored section body sometimes carries real markup — a `<form>` plus
      // its `<script>` — rather than prose. Printing it as `body` shows escaped source
      // code on the page; a sandboxed frame is the fix, never raw interpolation, because
      // this is untrusted content from a free-text brief. `escapeHtml` here is
      // entity-encoding for the `srcdoc` ATTRIBUTE position — the browser decodes it back
      // to the real markup before handing it to the sandboxed frame's own parser.
      return isMarkupSectionBody(section)
        ? `<section class="s">${eyebrow}${heading}<iframe class="content-frame" title="${escapeHtml(section.heading || 'content')}" sandbox="${WEBSITE_CONTENT_FRAME_SANDBOX}" srcdoc="${escapeHtml(section.body ?? '')}"></iframe>${cta}</section>`
        : `<section class="s">${eyebrow}${heading}${body}${cta}</section>`;
    case 'cta':
      return `<section class="s call">${eyebrow}${heading}${body}${cta}</section>`;
  }
}

function renderPage(page: WebsitePage, index: number, ctaHref: string | null): string {
  return `<main class="page" data-page="${escapeHtml(page.id)}"${index === 0 ? '' : ' hidden'}>${
    page.sections.map((section) => renderSection(section, ctaHref)).join('')}</main>`;
}

const STYLES = `
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:960px;margin:0 auto;padding:0 20px 72px}
nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:16px 0;border-bottom:1px solid var(--line)}
nav .brand{font-weight:700;letter-spacing:-.02em;margin-right:6px}
nav button{font:inherit;font-size:.85rem;font-weight:600;color:var(--muted);background:transparent;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}
nav button[aria-current="true"]{background:var(--panel);color:var(--fg)}
nav .enter{margin-left:auto;font-size:.85rem;font-weight:650;color:var(--onAccent);background:var(--accent);border-radius:7px;padding:8px 14px;text-decoration:none}
.s{padding:52px 0;border-bottom:1px solid var(--line)}
.s:last-child{border-bottom:0}
h1{font-size:clamp(2rem,6vw,3.2rem);line-height:1.08;letter-spacing:-.035em;margin:0 0 16px;text-wrap:balance}
h2{font-size:clamp(1.4rem,3.4vw,2rem);line-height:1.15;letter-spacing:-.03em;margin:0 0 14px;text-wrap:balance}
h3{font-size:1rem;margin:0 0 6px;letter-spacing:-.01em}
p{margin:0 0 14px}
.body{color:var(--muted);max-width:60ch;font-size:1.05rem}
.eyebrow{font-size:.72rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin:0 0 10px}
.actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:26px}
.cta{display:inline-block;background:var(--accent);color:var(--onAccent);font-weight:650;border-radius:9px;padding:12px 22px;text-decoration:none}
.cta2{color:var(--muted);font-size:.92rem}
ul{list-style:none;margin:22px 0 0;padding:0;display:grid;gap:18px}
ul.features{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
ul.features li{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:18px 20px}
ul.features p{color:var(--muted);font-size:.92rem;margin:0}
ul.stats{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
ul.stats b{display:block;font-size:2.1rem;letter-spacing:-.03em;color:var(--accent);font-variant-numeric:tabular-nums}
ul.stats span{color:var(--muted);font-size:.85rem}
.content-frame{width:100%;min-height:420px;border:0;border-radius:8px;background:var(--panel)}
.quote blockquote{margin:0;font-size:clamp(1.15rem,2.6vw,1.6rem);line-height:1.4;letter-spacing:-.02em;text-wrap:balance}
.quote cite{display:block;margin-top:14px;font-style:normal;color:var(--muted);font-size:.88rem}
.call{text-align:center}
.call .actions{justify-content:center}
footer{padding:26px 0;color:var(--muted);font-size:.8rem;border-top:1px solid var(--line)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
@media (prefers-reduced-motion:no-preference){.page{animation:in .2s ease both}@keyframes in{from{opacity:0}}}
`;

/** The page switcher. Inline, tiny, and the only script the document adds itself. */
const SWITCH_SCRIPT = `
(function(){var n=document.querySelectorAll('nav button[data-go]');
function show(id){document.querySelectorAll('.page').forEach(function(p){p.hidden=p.dataset.page!==id});
n.forEach(function(b){b.setAttribute('aria-current',String(b.dataset.go===id))});}
n.forEach(function(b){b.addEventListener('click',function(){show(b.dataset.go)})});})();
`;

export interface WebsiteDocumentOptions {
  /** The site's own name, shown in the nav. */
  brand: string;
  /** A door out of this document, e.g. back into the signed-in app. Omitted entirely
   *  when the caller has nowhere for it to go — the canvas `app` surface has no such
   *  door, so it renders none rather than a link to nowhere. */
  enterPath?: string;
  /** Label for `enterPath`. Ignored when `enterPath` is absent. */
  enterLabel?: string;
  activePageId?: unknown;
}

/**
 * Render the authored website to ONE self-contained HTML document.
 * Returns null when there is nothing publishable — an object with no parseable page
 * must not produce an empty shell that replaces whatever was asking for it.
 */
export function renderWebsiteDocument(
  pages: WebsitePage[],
  theme: WebsiteTheme,
  options: WebsiteDocumentOptions,
): string | null {
  if (!pages.length) return null;
  const { brand, enterPath, enterLabel } = options;

  const first = activeWebsitePage(pages, options.activePageId) ?? pages[0]!;
  const ordered = [first, ...pages.filter((page) => page.id !== first.id)];
  const hero = first.sections.find((section) => section.kind === 'hero');
  const title = hero?.heading || brand;
  const description = hero?.body ?? '';

  const nav = `<nav><span class="brand">${escapeHtml(brand)}</span>${
    ordered.length > 1
      ? ordered.map((page, index) => `<button type="button" data-go="${escapeHtml(page.id)}" aria-current="${index === 0}">${escapeHtml(page.name)}</button>`).join('')
      : ''
  }${enterPath ? `<a class="enter" href="${escapeHtml(enterPath)}">${escapeHtml(enterLabel ?? '')}</a>` : ''}</nav>`;

  const light = paletteFor(theme, 'light');
  const dark = paletteFor(theme, 'dark');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
${description ? `<meta name="description" content="${escapeHtml(description.slice(0, 300))}">` : ''}
<meta property="og:title" content="${escapeHtml(title)}">
${description ? `<meta property="og:description" content="${escapeHtml(description.slice(0, 300))}">` : ''}
<style>:root{${cssVars(light)};color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{${cssVars(dark)}}}
${STYLES}</style></head>
<body><div class="wrap">${nav}${ordered.map((page, index) => renderPage(page, index, enterPath ?? null)).join('')}
<footer>${escapeHtml(brand)}</footer></div>
${ordered.length > 1 ? `<script>${SWITCH_SCRIPT}</script>` : ''}</body></html>`;
}
