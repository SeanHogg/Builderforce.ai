import { describe, it, expect } from 'vitest';
import { classifyGuestBrainstormEntry, classifyShell, isFramedEmbed, rendersAppShell } from './shellRouting';

describe('classifyGuestBrainstormEntry', () => {
  it('does not mount the legacy redirect before the browser resolves ?room=', () => {
    expect(classifyGuestBrainstormEntry(undefined)).toBe('resolving');
    expect(classifyGuestBrainstormEntry('dzqnn3qc9h23')).toBe('room');
    expect(classifyGuestBrainstormEntry(null)).toBe('legacy');
  });
});

describe('classifyShell — app-shell deny-list model [1557]', () => {
  it('renders full-screen routes with no chrome', () => {
    expect(classifyShell('/embed/kanban')).toBe('none');
    expect(classifyShell('/webcontainer')).toBe('none');
    expect(classifyShell('/auth/callback')).toBe('none');
  });

  it('renders auth screens footer-only', () => {
    expect(classifyShell('/login')).toBe('footer');
    expect(classifyShell('/register')).toBe('footer');
  });

  it('mounts /activate itself instead of the marketing teaser', () => {
    // Regression: /activate used to fall through to the app shell, so a signed-out
    // visitor following the VS Code device link (/activate?code=XXXX-XXXX) saw the
    // generic "This is part of Builderforce.ai" gate — the page never mounted, so
    // its own sign-in redirect never fired and the device flow dead-ended.
    expect(classifyShell('/activate')).toBe('footer');
  });

  it('renders marketing/public routes in the public shell', () => {
    expect(classifyShell('/')).toBe('public');
    expect(classifyShell('/about')).toBe('public');
    expect(classifyShell('/product')).toBe('public');
    expect(classifyShell('/blog')).toBe('public');
    expect(classifyShell('/blog/some-post')).toBe('public');
    expect(classifyShell('/tutorials')).toBe('public');
    expect(classifyShell('/pricing')).toBe('public');
    expect(classifyShell('/crm/phone')).toBe('public');
    expect(classifyShell('/compare')).toBe('public'); // added so the inversion doesn't give marketing the app shell
    expect(classifyShell('/marketplace')).toBe('public');
    // Dedicated Evermind marketing page (app/evermind/page.tsx) must render its
    // own rich content for logged-out visitors, not the RouteMarketing teaser.
    expect(classifyShell('/evermind')).toBe('public');
    expect(classifyShell('/agents/overview')).toBe('public');
    // Programmatic-SEO integrations surface must render its real content for
    // logged-out visitors + crawlers (robots-Allowed + in sitemap), not a teaser.
    expect(classifyShell('/integrations')).toBe('public');
    expect(classifyShell('/integrations/github')).toBe('public');
    // Media kit (downloadable sales deck) must be reachable logged-out.
    expect(classifyShell('/media')).toBe('public');
    // Sales-associate enrollment is a public marketing surface, not an app gate.
    expect(classifyShell('/sell-builderforce')).toBe('public');
    // Guided demo deck (the 5-scenario walkthrough) is a public marketing route.
    expect(classifyShell('/demo')).toBe('public');
  });

  it('does not treat a prefix collision as public', () => {
    expect(classifyShell('/modelsomething')).toBe('app');
  });

  it('does not mistake the Embedded destination for the framed embed surface', () => {
    // `/embedded` starts with `/embed`, and every prefix list here used a bare
    // `startsWith` — so the Embedded Capabilities page was classified as a
    // cross-origin iframe: no chrome, the lean provider tree, and invisible to
    // crawlers. Prefixes compare segments now.
    expect(isFramedEmbed('/embed/kanban')).toBe(true);
    expect(isFramedEmbed('/embed')).toBe(true);
    expect(isFramedEmbed('/embedded')).toBe(false);
    // It is a reference surface (PRD 21 §11.4.5): a real public page signed out,
    // a panel over the board signed in.
    expect(classifyShell('/embedded')).toBe('public');
    expect(rendersAppShell('/embedded', true)).toBe(true);
  });

  it('renders known authenticated routes in the app shell', () => {
    expect(classifyShell('/dashboard')).toBe('app');
    expect(classifyShell('/projects')).toBe('app');
    expect(classifyShell('/projects/123')).toBe('app');
    expect(classifyShell('/tasks')).toBe('app');
    expect(classifyShell('/settings')).toBe('app');
    expect(classifyShell('/admin')).toBe('app');
  });

  it('DEFAULTS an unlisted authed route to the app shell (the fix)', () => {
    // /ceremonies was getting the wrong (public) chrome under the old allow-list;
    // and any NEW authed page now gets correct app chrome without being listed.
    expect(classifyShell('/ceremonies')).toBe('app');
    expect(classifyShell('/some-future-feature')).toBe('app');
  });
});

/**
 * "The canvas is the product" (PRD 21 §0) is only true if it is the SAME product
 * for both visitors. An anonymous board used to render inside `MarketingShell`:
 * the top-of-funnel nav where the session list, the stage and the team belong. So
 * a person invited to try the thing they were being sold saw a different thing.
 */
describe('rendersAppShell — one shell, signed in or not', () => {
  it('gives an anonymous canvas the operator shell, not marketing chrome', () => {
    expect(rendersAppShell('/create/local-abc123', false)).toBe(true);
    expect(rendersAppShell('/create/local-abc123?share=1'.split('?')[0], false)).toBe(true);
  });

  it('shows a guest the canvas library that holds their own drafts', () => {
    // It used to redirect to /login, making the library the ONE place a guest's
    // own boards were guaranteed not to be visible.
    expect(rendersAppShell('/create', false)).toBe(true);
  });

  it('mounts the prompt-led entry point so `?prompt=` is not thrown away', () => {
    // Regression: /create/new is the ONE prompt-led entry point — it creates the
    // local session from `?prompt=` and replaces the URL. Teasing it meant the
    // page never mounted, the session was never created, and the prompt was lost.
    // Every prompt-carrying CTA lands here (tutorials, blog courses, model
    // comparison, /brainstorm), and the teaser's own primary button points back
    // at /create/new — so a signed-out visitor looped on the teaser.
    expect(rendersAppShell('/create/new', false)).toBe(true);
    expect(rendersAppShell('/create/new', true)).toBe(true);
  });

  it('mounts the invitation page for the signed-out recipient it was written for', () => {
    // It renders its own "sign in with the invited email" branch, so as a plain
    // app route the teaser mounted in its place and the invite dead-ended.
    expect(rendersAppShell(`/create/invitations/${'a'.repeat(64)}`, false)).toBe(true);
  });

  it('still teases every OTHER app route to a signed-out visitor', () => {
    expect(rendersAppShell('/dashboard', false)).toBe(false);
    expect(rendersAppShell('/projects/12', false)).toBe(false);
    // A durable (server-persisted) canvas is somebody's workspace, not a guest's.
    expect(rendersAppShell('/create/sess_9f2a', false)).toBe(false);
  });

  it('gives a signed-in visitor the shell on every app route, and never off one', () => {
    expect(rendersAppShell('/dashboard', true)).toBe(true);
    expect(rendersAppShell('/create/local-abc123', true)).toBe(true);
    expect(rendersAppShell('/pricing', true)).toBe(false);
    expect(rendersAppShell('/login', true)).toBe(false);
    expect(rendersAppShell('/embed/kanban', true)).toBe(false);
  });
});
