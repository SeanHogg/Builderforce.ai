import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MarketingShell from './MarketingShell';

const routing = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => routing.pathname,
}));

vi.mock('./MarketingHeader', () => ({ default: () => <header>Marketing header</header> }));
vi.mock('./MobileBottomNav', () => ({ default: () => <nav>Mobile nav</nav> }));
vi.mock('./AppFooter', () => ({ default: () => <footer>Marketing footer</footer> }));

describe('MarketingShell', () => {
  beforeEach(() => { routing.pathname = '/'; });

  it('keeps normal marketing pages scrollable with their footer', () => {
    render(<MarketingShell><div>Page</div></MarketingShell>);

    expect(screen.getByText('Marketing footer')).toBeTruthy();
    expect(screen.getByRole('main').className).toBe('marketing-content');
  });

  it('gives an anonymous local canvas the full remaining viewport', () => {
    routing.pathname = '/create/local-session-1';
    const { container } = render(<MarketingShell><div>Canvas</div></MarketingShell>);

    expect(screen.queryByText('Marketing footer')).toBeNull();
    expect(container.firstElementChild?.classList.contains('marketing-frame-full-height')).toBe(true);
    expect(screen.getByRole('main').classList.contains('marketing-content-full-height')).toBe(true);
  });
});
