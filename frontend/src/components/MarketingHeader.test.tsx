import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const routing = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => routing.pathname }));

vi.mock('./HeaderCartButton', () => ({ HeaderCartButton: () => <span>Cart</span> }));
vi.mock('@/components/ThemeToggleButton', () => ({ ThemeToggleButton: () => <span>Theme</span> }));

const localWork = vi.hoisted(() => ({ sessions: [] as Array<{ sessionId: string }> }));
vi.mock('@/domains/canvas/infrastructure/localCanvasStore', () => ({ listLocalCreationSessions: () => localWork.sessions }));

const { default: MarketingHeader } = await import('./MarketingHeader');

describe('the marketing header CTA on a canvas route', () => {
  beforeEach(() => {
    routing.pathname = '/create/local-session-1';
    localWork.sessions = [];
  });

  it('offers "Get Started" while the guest board is still empty', () => {
    render(<MarketingHeader />);
    expect(screen.getAllByRole('link', { name: /get started/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Keep your work' })).toBeNull();
  });

  it('switches to "Keep your work" once this browser holds real local canvas work', () => {
    localWork.sessions = [{ sessionId: 'local-session-1' }];
    render(<MarketingHeader />);
    const ctas = screen.getAllByRole('link', { name: 'Keep your work' });
    expect(ctas.length).toBeGreaterThan(0);
    for (const cta of ctas) {
      // It carries the board back. This CTA is now the ONLY offer to keep a guest
      // board — the canvas dropped its own "Save & collaborate" so one screen stopped
      // holding two bars saying the same word — so landing back on the canvas after
      // sign-up is this link's job, not a nicety.
      expect(cta.getAttribute('href')).toBe('/register?next=%2Fcreate%2Flocal-session-1');
      // Never the same visual language as the plain invitation — the offer only
      // exists once there is something to lose.
      expect(cta.className).toContain('mh-cta-keep');
    }
  });

  it('never shows the "keep" CTA on a plain marketing page, whatever this browser holds', () => {
    routing.pathname = '/';
    localWork.sessions = [{ sessionId: 'local-session-1' }];
    render(<MarketingHeader />);
    expect(screen.queryByRole('link', { name: 'Keep your work' })).toBeNull();
    expect(screen.getAllByRole('link', { name: /open the canvas/i }).length).toBeGreaterThan(0);
  });
});

/**
 * The Product ▾ / Learn ▾ menus are a real disclosure: ONE open state, which
 * the trigger announces and the stylesheet reads — opened by a click or tap, by
 * Enter on the focused button, or by a mouse hover; closed by the same click,
 * Escape, a press outside, or the mouse leaving a menu it hovered open.
 */
describe('the marketing header menus', () => {
  beforeEach(() => { routing.pathname = '/'; });

  const trigger = (name: string) => screen.getByRole('button', { name });
  const panelOf = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-controls') ?? '');

  it('points the trigger at the panel it controls', () => {
    render(<MarketingHeader />);
    const product = trigger('Product');
    expect(product).toHaveAttribute('aria-expanded', 'false');
    const panel = panelOf(product);
    expect(panel).not.toBeNull();
    expect(product.parentElement!.contains(panel)).toBe(true);
  });

  it('toggles on a click or tap, and says so', () => {
    render(<MarketingHeader />);
    const product = trigger('Product');
    fireEvent.click(product);
    expect(product).toHaveAttribute('aria-expanded', 'true');
    expect(product.parentElement).toHaveAttribute('data-open');
    fireEvent.click(product);
    expect(product).toHaveAttribute('aria-expanded', 'false');
    expect(product.parentElement).not.toHaveAttribute('data-open');
  });

  it('closes on Escape and hands focus back to the trigger', () => {
    render(<MarketingHeader />);
    const learn = trigger('Learn');
    fireEvent.click(learn);
    const firstLink = panelOf(learn)!.querySelector('a')!;
    firstLink.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(learn).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(learn);
  });

  it('closes on a press outside the nav', () => {
    render(<MarketingHeader />);
    const product = trigger('Product');
    fireEvent.click(product);
    fireEvent.mouseDown(document.body);
    expect(product).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on a mouse hover and closes when the mouse leaves', () => {
    render(<MarketingHeader />);
    const product = trigger('Product');
    fireEvent.pointerEnter(product.parentElement!, { pointerType: 'mouse' });
    expect(product).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerLeave(product.parentElement!, { pointerType: 'mouse' });
    expect(product).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps a hover-opened menu open when it is clicked, rather than shutting it under the cursor', () => {
    render(<MarketingHeader />);
    const product = trigger('Product');
    fireEvent.pointerEnter(product.parentElement!, { pointerType: 'mouse' });
    fireEvent.click(product);
    expect(product).toHaveAttribute('aria-expanded', 'true');
    // Pinned by the click: leaving no longer closes it.
    fireEvent.pointerLeave(product.parentElement!, { pointerType: 'mouse' });
    expect(product).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not treat a touch as a hover', () => {
    render(<MarketingHeader />);
    const product = trigger('Product');
    fireEvent.pointerEnter(product.parentElement!, { pointerType: 'touch' });
    expect(product).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens one menu at a time', () => {
    render(<MarketingHeader />);
    fireEvent.click(trigger('Product'));
    fireEvent.click(trigger('Learn'));
    expect(trigger('Product')).toHaveAttribute('aria-expanded', 'false');
    expect(trigger('Learn')).toHaveAttribute('aria-expanded', 'true');
  });

  it('leaves the stylesheet reading ONLY the open state, never :hover or :focus-within', () => {
    // A CSS-only opener is what made `aria-expanded` lie: a tap left `:hover`
    // stuck on, and Escape left `:focus-within` holding the panel open.
    const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
    expect(css).not.toMatch(/\.has-menu:(?:hover|focus-within)[^{]*\.mh-panel/);
    expect(css).not.toMatch(/\.has-menu:hover::after/);
  });
});
