import { describe, it, expect } from 'vitest';
import { classifyShell } from './ConditionalAppShell';

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

  it('renders marketing/public routes in the public shell', () => {
    expect(classifyShell('/')).toBe('public');
    expect(classifyShell('/product')).toBe('public');
    expect(classifyShell('/blog')).toBe('public');
    expect(classifyShell('/blog/some-post')).toBe('public');
    expect(classifyShell('/pricing')).toBe('public');
    expect(classifyShell('/compare')).toBe('public'); // added so the inversion doesn't give marketing the app shell
    expect(classifyShell('/marketplace')).toBe('public');
    expect(classifyShell('/agents/overview')).toBe('public');
    // Programmatic-SEO integrations surface must render its real content for
    // logged-out visitors + crawlers (robots-Allowed + in sitemap), not a teaser.
    expect(classifyShell('/integrations')).toBe('public');
    expect(classifyShell('/integrations/github')).toBe('public');
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
