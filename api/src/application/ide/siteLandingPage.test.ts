import { describe, expect, it } from 'vitest';
import { ENTER_APP_HREF, renderLandingPage, escapeHtml, SITE_LANDING_KEY } from './siteLandingPage';
import { ENTER_APP_PARAM, landingPageApplies } from './siteVisitor';
import type { SiteRecord } from './siteHosting';
import type { WebsitePage, WebsiteTheme } from '@builderforce/creation-canvas-contract';

const theme: WebsiteTheme = { style: 'editorial' };

const pages: WebsitePage[] = [
  {
    id: 'home', name: 'Home', path: '/', sections: [
      { id: 'hero', kind: 'hero', heading: 'Nobody misses Sunday dinner', body: 'Send one link.', cta: 'Start free' },
      { id: 'stats', kind: 'stats', items: [{ value: '412', label: 'replies' }] },
    ],
  },
  {
    id: 'pricing', name: 'Pricing', path: '/pricing', sections: [
      { id: 'cta-1', kind: 'cta', heading: 'Ready?', cta: 'Start free' },
    ],
  },
];

const site = (over: Partial<SiteRecord> = {}): SiteRecord => ({
  siteId: 1, projectId: 2, tenantId: 3, r2Prefix: 'sites/x/v1/', status: 'active',
  versionToken: 'v1', indexDocument: 'index.html', landingObjectId: 'obj-1', ...over,
});

describe('landing page rendering', () => {
  it('renders every page into ONE document, so the landing page owns exactly one address', () => {
    const html = renderLandingPage({ pages, theme, brand: 'Sunday RSVP' })!;
    // Both pages are present…
    expect(html).toContain('data-page="home"');
    expect(html).toContain('data-page="pricing"');
    // …and only the first is shown, the rest switched client-side. A second document at
    // `/pricing` is the URL-space collision publishing them together exists to avoid.
    expect(html).toContain('data-page="pricing" hidden');
    expect(html).not.toContain('href="/pricing"');
  });

  it('escapes authored copy — every field in the document came from a creator', () => {
    const nasty: WebsitePage[] = [{
      id: 'home', name: 'Home', path: '/', sections: [
        { id: 'hero', kind: 'hero', heading: '<script>alert(1)</script>', body: 'Fine', cta: 'Go' },
      ],
    }];
    const html = renderLandingPage({ pages: nasty, theme, brand: 'Acme' })!;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    // The page switcher is the ONLY script in the document, and a single page has none.
    expect(html).not.toContain('<script>');
  });

  it('renders a content section carrying real markup in a sandboxed frame, not as escaped text', () => {
    const markup: WebsitePage[] = [{
      id: 'quote', name: 'Quote', path: '/quote', sections: [
        { id: 'hero', kind: 'hero', heading: 'Get a quote', body: 'Fill it in', cta: 'Go' },
        { id: 'form', kind: 'content', heading: 'Request a quote', body: '<form><input name="email"><script>track()</script></form>' },
      ],
    }];
    const html = renderLandingPage({ pages: markup, theme, brand: 'Acme' })!;
    // The raw markup never appears unescaped in the document body…
    expect(html).not.toContain('<form><input name="email">');
    // …it is entity-encoded into a sandboxed iframe's `srcdoc` attribute, which the
    // browser decodes back to real markup only inside the isolated frame.
    expect(html).toMatch(/<iframe class="content-frame"[^>]*sandbox="allow-scripts allow-forms"[^>]*srcdoc="[^"]*&lt;form&gt;/);
    expect(html).not.toContain('allow-same-origin');
  });

  it('still escapes a content section with plain prose, not markup', () => {
    const prose: WebsitePage[] = [{
      id: 'about', name: 'About', path: '/about', sections: [
        { id: 'hero', kind: 'hero', heading: 'About us', body: 'Hi', cta: 'Go' },
        { id: 'about-body', kind: 'content', heading: 'Our story', body: 'We started in a garage.' },
      ],
    }];
    const html = renderLandingPage({ pages: prose, theme, brand: 'Acme' })!;
    expect(html).toContain('<p class="body">We started in a garage.</p>');
    expect(html).not.toMatch(/<iframe class="content-frame"/);
  });

  it('escapes the brand in the title as well as the body', () => {
    const html = renderLandingPage({ pages: [pages[0]!], theme, brand: '"><b>x' })!;
    expect(html).not.toContain('"><b>x');
    expect(escapeHtml('"><b>x')).toBe('&quot;&gt;&lt;b&gt;x');
  });

  it('defines both colour schemes, because the document is served to strangers', () => {
    const html = renderLandingPage({ pages, theme, brand: 'Acme' })!;
    expect(html).toContain('color-scheme:light dark');
    expect(html).toMatch(/@media \(prefers-color-scheme:dark\)\{:root\{--bg:/);
  });

  it('keeps an authored accent in both schemes rather than substituting one', () => {
    const html = renderLandingPage({ pages, theme: { style: 'bold', accent: '#ff5500' }, brand: 'Acme' })!;
    expect(html.match(/--accent:#ff5500/g)?.length).toBe(2);
  });

  it('refuses a colour it cannot safely inline', () => {
    const html = renderLandingPage({ pages, theme: { style: 'bold', accent: 'red;}body{display:none' }, brand: 'A' })!;
    expect(html).not.toContain('display:none');
  });

  it('produces nothing when there is no publishable page', () => {
    // Load-bearing: an empty shell written to the landing key would replace the app for
    // every visitor who is not signed in.
    expect(renderLandingPage({ pages: [], theme, brand: 'Acme' })).toBeNull();
  });

  it('adds the commerce widget only when a caller supplies its src', () => {
    expect(renderLandingPage({ pages, theme, brand: 'Acme' })).not.toContain('data-bf-commerce');
    expect(renderLandingPage({ pages, theme, brand: 'Acme' })).not.toContain('<script src=');

    const withWidget = renderLandingPage({
      pages, theme, brand: 'Acme', commerceScriptSrc: '/__api/billing/widget.js',
    })!;
    expect(withWidget).toContain('<script src="/__api/billing/widget.js" defer></script>');
  });

  it('escapes a commerce script src the same as every other authored field', () => {
    const html = renderLandingPage({
      pages, theme, brand: 'Acme', commerceScriptSrc: '"><script>alert(1)</script>',
    })!;
    expect(html).not.toContain('"><script>alert(1)</script>');
  });

  it('renders a total switch over the declared vocabulary', () => {
    const all: WebsitePage[] = [{
      id: 'home', name: 'Home', path: '/', sections: [
        { id: 'a', kind: 'hero', heading: 'H', body: 'B', cta: 'C' },
        { id: 'b', kind: 'features', heading: 'F', items: [{ title: 'T', body: 'B' }] },
        { id: 'c', kind: 'content', heading: 'C', body: 'B' },
        { id: 'd', kind: 'stats', items: [{ value: '1', label: 'L' }] },
        { id: 'e', kind: 'testimonial', quote: 'Q', author: 'A' },
        { id: 'f', kind: 'cta', heading: 'R', cta: 'Go' },
      ],
    }];
    const html = renderLandingPage({ pages: all, theme, brand: 'Acme' })!;
    for (const marker of ['H', 'F', 'C', 'L', 'Q', 'R']) expect(html).toContain(marker);
    expect(html).not.toContain('undefined');
  });
});

const at = (path: string) => new URL(`https://app.example.com${path}`);

describe('when the landing page applies', () => {
  it('forks the entry document only', () => {
    expect(landingPageApplies(site(), at('/'))).toBe(true);
    expect(landingPageApplies(site(), at('/index.html'))).toBe(true);
    // A deep link was sent to somebody on purpose; an asset is not a shop window.
    expect(landingPageApplies(site(), at('/dashboard'))).toBe(false);
    expect(landingPageApplies(site(), at('/assets/app.js'))).toBe(false);
  });

  it('lets the shop window have an exit', () => {
    // Without this the app's own door — the site root — serves the landing page
    // again, and a visitor can never reach the screen that signs them in.
    expect(landingPageApplies(site(), at(ENTER_APP_HREF))).toBe(false);
    expect(renderLandingPage({ pages, theme, brand: 'Acme' })).toContain(`href="/?${ENTER_APP_PARAM}=1"`);
  });

  it('costs nothing at all on a site with no landing page', () => {
    // The check reads a field already on the cached record — no database, no R2.
    expect(landingPageApplies(site({ landingObjectId: null }), at('/'))).toBe(false);
  });

  it('reserves its own key under the release prefix', () => {
    expect(SITE_LANDING_KEY.startsWith('__')).toBe(true);
  });
});
