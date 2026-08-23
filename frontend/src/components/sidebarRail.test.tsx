import { readFile } from 'node:fs/promises';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NAV_GROUPS } from '@/lib/navGroups';
import Sidebar from './Sidebar';

/**
 * WHERE THE RAIL'S BOTTOM CHROME IS DRAWN.
 *
 * The copyright/version/Terms strip trailed the stage list instead of sitting in
 * the bottom-left corner, leaving four hundred pixels of empty rail UNDER it. The
 * cause was `.nav-main { flex: 0 1 auto }` — itself a fix for the opposite
 * complaint, that growing the nav spaced the stage rows out down the rail. Both
 * are true, which is why neither element can own the pin: the leftover height
 * belongs to a margin BETWEEN them, not to either box.
 *
 * So there are two halves to hold, and a test for each. Nothing here can see
 * layout — jsdom computes none — so neither asserts a pixel. They assert the two
 * facts that produce the pixels: the strip is inside the pinned box, and the box
 * is what carries the auto margin.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/create/abc' }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: null, isAuthenticated: false }) }));
vi.mock('@/lib/destinations/useDestinations', () => ({ useNavGroups: () => NAV_GROUPS }));
vi.mock('./SessionList', () => ({ default: () => <div data-testid="sessions" /> }));
vi.mock('./UsageMeter', () => ({ default: () => <div data-testid="usage" /> }));
vi.mock('./legal/LegalStrip', () => ({
  LegalStrip: ({ className }: { className: string }) => <div className={className} data-testid="legal" />,
}));

describe('the sidebar rail', () => {
  it('draws its legal strip inside the pinned bottom box, not after the stage list', () => {
    render(<Sidebar collapsed={false} onToggleCollapsed={() => {}} />);
    const bottom = document.querySelector('.nav-rail-bottom');
    expect(bottom).not.toBeNull();
    // Containment, not sibling order: a strip that merely FOLLOWS the box is drawn
    // below the pin and back in the corner the bug put it in.
    expect(bottom!.contains(screen.getByTestId('legal'))).toBe(true);
  });

  it('gives the icon rail no bottom box to pin, since it drops all three rows', () => {
    render(<Sidebar collapsed onToggleCollapsed={() => {}} />);
    expect(document.querySelector('.nav-rail-bottom')?.children.length ?? 0).toBe(0);
  });

  it('pins the bottom box by its own margin and lets the nav above it stay content-sized', async () => {
    // Path from the vitest root (`frontend/`), not `import.meta.url`: the dom
    // environment rewrites module URLs to a non-file scheme and `readFile` refuses them.
    const css = await readFile('src/app/globals.css', 'utf8');
    const ruleFor = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`);
      expect(start, `${selector} has no rule`).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf('\n}', start));
    };

    expect(ruleFor('.nav-rail-bottom')).toMatch(/margin-top: *auto/);
    // The regression is re-adding grow here: the height then goes to the stage
    // list and the rows spread out again.
    expect(ruleFor('.nav-main')).toMatch(/flex: *0 /);
  });
});
