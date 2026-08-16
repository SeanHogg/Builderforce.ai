/**
 * The creator's own shop window — a `website` canvas object rendered to a static
 * document and published with the app it sells.
 *
 * ── THE DECISION THIS IMPLEMENTS ─────────────────────────────────────────────────
 * Two shop windows, one product: the marketplace listing sells the app inside the
 * marketplace, and this sells it in the creator's own brand on their own address.
 * A visitor who is not yet a user of the app is served THIS; a signed-in user is
 * served the app. One fork, in `tryServeHostedSite`, reading one rule.
 *
 * ── WHY A SECOND RENDERER, AND WHAT IT IS NOT ALLOWED TO RESTATE ─────────────────
 * The canvas draws this same object as React on the `site` surface. That cannot run
 * here: publishing happens in a Worker, and the output has to be a document a browser
 * gets with no framework, no hydration and no network beyond itself. So the PIXELS are
 * written twice and everything else exactly once — the section vocabulary, the parser
 * and the block operations all come from `@builderforce/creation-canvas-contract`. If a
 * section kind appears in a `switch` here that the contract does not declare, that is
 * the drift this arrangement exists to prevent.
 *
 * ── WHY ALL PAGES LAND IN ONE DOCUMENT ───────────────────────────────────────────
 * A landing page with a Pricing tab could publish `/pricing.html` — and then a landing
 * page and an app would be competing for the same URL space, which is the collision the
 * single-publish rule exists to remove. Every page is therefore rendered into ONE
 * document and switched client-side, so the landing page occupies exactly one key and
 * exactly one address: the site root. The app keeps every other path it has today.
 */

import { and, eq } from 'drizzle-orm';
import {
  activeWebsitePage,
  websitePagesFrom,
  websiteThemeFrom,
  type WebsitePage,
  type WebsiteSection,
  type WebsiteTheme,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import { ENTER_APP_PARAM } from './siteVisitor';
import {
  creationSessionObjects,
  creationSessionProjectLinks,
  SESSION_PROJECT_LINK_APP,
} from '../../infrastructure/database/schema';

/**
 * Where the landing document lives inside a release's own version prefix.
 *
 * Inside the version prefix rather than beside it so a rollback restores the landing
 * page and the build it shipped with as one pair — the whole point of publishing them
 * together. The leading `__` matches the reserved `/__api/` convention, and
 * `publishStaticSite` refuses an uploaded asset at this exact path so a build can never
 * claim it.
 */
export const SITE_LANDING_KEY = '__landing.html';

export interface LandingSource {
  /** The canvas object the document was rendered from — stored on the site so the
   *  next publish re-renders the SAME object rather than re-guessing. */
  objectId: string;
  html: string;
}

/* ── Palette ───────────────────────────────────────────────────────────────────── */

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

/* ── Rendering ─────────────────────────────────────────────────────────────────── */

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
function renderSection(section: WebsiteSection, ctaHref: string): string {
  const eyebrow = section.eyebrow ? `<p class="eyebrow">${escapeHtml(section.eyebrow)}</p>` : '';
  const heading = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : '';
  const body = section.body ? `<p class="body">${escapeHtml(section.body)}</p>` : '';
  const cta = section.cta
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
      return `<section class="s">${eyebrow}${heading}${body}${cta}</section>`;
    case 'cta':
      return `<section class="s call">${eyebrow}${heading}${body}${cta}</section>`;
  }
}

function renderPage(page: WebsitePage, index: number, ctaHref: string): string {
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
.quote blockquote{margin:0;font-size:clamp(1.15rem,2.6vw,1.6rem);line-height:1.4;letter-spacing:-.02em;text-wrap:balance}
.quote cite{display:block;margin-top:14px;font-style:normal;color:var(--muted);font-size:.88rem}
.call{text-align:center}
.call .actions{justify-content:center}
footer{padding:26px 0;color:var(--muted);font-size:.8rem;border-top:1px solid var(--line)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
@media (prefers-reduced-motion:no-preference){.page{animation:in .2s ease both}@keyframes in{from{opacity:0}}}
`;

/** The page switcher. Inline, tiny, and the only script in the document. */
const SWITCH_SCRIPT = `
(function(){var n=document.querySelectorAll('nav button[data-go]');
function show(id){document.querySelectorAll('.page').forEach(function(p){p.hidden=p.dataset.page!==id});
n.forEach(function(b){b.setAttribute('aria-current',String(b.dataset.go===id))});}
n.forEach(function(b){b.addEventListener('click',function(){show(b.dataset.go)})});})();
`;

/**
 * The app's door, seen from the shop window.
 *
 * The app lives at the site root and the fork claims the site root, so every way into
 * the product carries the opt-out parameter — otherwise a visitor who presses "Open
 * the app" is handed the landing page again and the shop window has no exit.
 */
export const ENTER_APP_HREF = `/?${ENTER_APP_PARAM}=1`;

export interface RenderLandingInput {
  pages: WebsitePage[];
  theme: WebsiteTheme;
  /** The site's own name, shown in the nav. */
  brand: string;
  /** Where "Open the app" goes. Always a path on this same site. */
  enterPath?: string;
  /** Label for the button that leaves the shop window and enters the product. */
  enterLabel?: string;
  activePageId?: unknown;
}

/**
 * Render the authored website to ONE self-contained HTML document.
 * Returns null when there is nothing publishable — an object with no parseable page
 * must not produce an empty shell that replaces the app for every visitor.
 */
export function renderLandingPage(input: RenderLandingInput): string | null {
  const { pages, theme, brand } = input;
  if (!pages.length) return null;

  const enterPath = input.enterPath ?? ENTER_APP_HREF;
  const enterLabel = input.enterLabel ?? 'Open the app';
  const first = activeWebsitePage(pages, input.activePageId) ?? pages[0]!;
  const ordered = [first, ...pages.filter((page) => page.id !== first.id)];
  const hero = first.sections.find((section) => section.kind === 'hero');
  const title = hero?.heading || brand;
  const description = hero?.body ?? '';

  const nav = `<nav><span class="brand">${escapeHtml(brand)}</span>${
    ordered.length > 1
      ? ordered.map((page, index) => `<button type="button" data-go="${escapeHtml(page.id)}" aria-current="${index === 0}">${escapeHtml(page.name)}</button>`).join('')
      : ''
  }<a class="enter" href="${escapeHtml(enterPath)}">${escapeHtml(enterLabel)}</a></nav>`;

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
<body><div class="wrap">${nav}${ordered.map((page, index) => renderPage(page, index, enterPath)).join('')}
<footer>${escapeHtml(brand)}</footer></div>
${ordered.length > 1 ? `<script>${SWITCH_SCRIPT}</script>` : ''}</body></html>`;
}

/**
 * Find the `website` object that IS this project's landing page, and render it.
 *
 * ── WHY THIS RESOLVES RATHER THAN ASKS ───────────────────────────────────────────
 * The creator does not pick a landing page from a list — under the "project IS the app"
 * decision the board that became the project already holds the `website` card they
 * authored, so a picker would be asking them to choose between one option and nothing.
 * `preferObjectId` is honoured when the site already recorded a choice, which is what
 * keeps a republish rendering the SAME card after they add a second one.
 *
 * Returns null when the project has no app session or no publishable website object —
 * a site with no landing page is served exactly as it is today.
 */
export async function landingPageForProject(
  db: Db,
  projectId: number,
  options: { brand: string; preferObjectId?: string | null; enterLabel?: string },
): Promise<LandingSource | null> {
  // ONE round trip: the app link and its website objects, joined. A separate
  // "find the session, then find its objects" pair would be two awaits on the
  // publish path for a question with a single answer.
  const rows = await db
    .select({ objectId: creationSessionObjects.id, canvasData: creationSessionObjects.canvasData })
    .from(creationSessionProjectLinks)
    .innerJoin(creationSessionObjects, eq(creationSessionObjects.sessionId, creationSessionProjectLinks.sessionId))
    .where(and(
      eq(creationSessionProjectLinks.projectId, projectId),
      eq(creationSessionProjectLinks.linkKind, SESSION_PROJECT_LINK_APP),
      eq(creationSessionObjects.kind, 'website'),
    ))
    .orderBy(creationSessionObjects.createdAt)
    .limit(WEBSITE_OBJECT_SCAN_LIMIT);
  if (!rows.length) return null;

  const chosen = (options.preferObjectId && rows.find((row) => row.objectId === options.preferObjectId)) || rows[0]!;
  const data = (chosen.canvasData ?? {}) as Record<string, unknown>;
  const html = renderLandingPage({
    pages: websitePagesFrom(data),
    theme: websiteThemeFrom(data),
    brand: options.brand,
    activePageId: data.activeWebsitePageId,
    ...(options.enterLabel ? { enterLabel: options.enterLabel } : {}),
  });
  return html ? { objectId: chosen.objectId, html } : null;
}

/** Bounded because a board can hold many cards and only one can be the shop window;
 *  scanning every `website` object on a large board to pick the first is wasted work. */
const WEBSITE_OBJECT_SCAN_LIMIT = 10;
