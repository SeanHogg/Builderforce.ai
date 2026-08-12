import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { DestinationIndex, INDEX_ROW_LIMIT, indexScrolls, resolveOrientation, type IndexItem } from './DestinationIndex';
import en from '@/i18n/messages/en.json';

/**
 * PRD 21 §6 — the acceptance criteria, as a test rather than as a promise.
 *
 * Three of the ten are structural and can only be defended mechanically, because
 * each is a rule the NEXT change breaks by accident rather than one this change
 * could get wrong:
 *
 *   #2  `SectionTabs`, `PillTabs` and `AdminGroupNav` have zero references.
 *   #3  No horizontal tab bar renders more than 6 items anywhere.
 *   #6  Locked destinations render visible and disabled, never hidden.
 *
 * The rest (the stage surviving a navigation, sign-in landing on the last board)
 * are behavioural and belong to their own surfaces' tests.
 */

const src = resolve(__dirname, '../..');
const read = (relative: string) => readFileSync(resolve(src, relative), 'utf8');

function item(id: string): IndexItem {
  return { id, label: id, href: `/x?tab=${id}` };
}

function renderIndex(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
}

describe('PRD 21 §6 — acceptance', () => {
  it('#2 the three tab bars are gone, and the shell renders the one index', () => {
    // The components themselves: deleted. Reading them must throw.
    for (const gone of ['components/SectionTabs.tsx', 'components/PillTabs.tsx', 'components/admin/AdminGroupNav.tsx']) {
      expect(() => read(gone)).toThrow();
    }
    // And the shell imports the replacement rather than a fourth tab bar.
    expect(read('components/AppShell.tsx')).toContain("from './shell/ShellIndex'");
  });

  /**
   * §6.3, as amended (operator decision, 2026-08-12): a nested sub-menu is a tab
   * ROW at the top of its page, and past the row limit it SCROLLS on one line
   * rather than flipping to a column. The constraint that survives is the one
   * that mattered — an over-long index must never wrap into a stacked block.
   */
  it('#3 an auto index is always a row, and past the limit it scrolls', () => {
    expect(resolveOrientation('auto', INDEX_ROW_LIMIT)).toBe('horizontal');
    expect(resolveOrientation('auto', INDEX_ROW_LIMIT + 1)).toBe('horizontal');
    expect(indexScrolls('horizontal', INDEX_ROW_LIMIT)).toBe(false);
    expect(indexScrolls('horizontal', INDEX_ROW_LIMIT + 1)).toBe(true);

    const many = Array.from({ length: 14 }, (_, i) => item(`t${i}`));
    const { container } = renderIndex(<DestinationIndex items={many} activeId="t0" ariaLabel="Sub-views" />);
    const nav = container.querySelector('.ui-index');
    expect(nav?.getAttribute('data-orientation')).toBe('horizontal');
    expect(nav?.getAttribute('data-scroll')).toBe('true');
  });

  it('#3 a short set stays a compact row that does not need to scroll', () => {
    const few = Array.from({ length: 4 }, (_, i) => item(`t${i}`));
    const { container } = renderIndex(<DestinationIndex items={few} activeId="t0" ariaLabel="Sub-views" />);
    const nav = container.querySelector('.ui-index');
    expect(nav?.getAttribute('data-orientation')).toBe('horizontal');
    expect(nav?.getAttribute('data-scroll')).toBeNull();
  });

  it('the column survives only where a caller owns one, and it is asked for', () => {
    const many = Array.from({ length: 8 }, (_, i) => item(`t${i}`));
    const { container } = renderIndex(
      <DestinationIndex items={many} activeId="t0" ariaLabel="Sub-views" orientation="vertical" />,
    );
    expect(container.querySelector('.ui-index')?.getAttribute('data-orientation')).toBe('vertical');
    // The shell panel is that caller — it must keep asking, or the rail becomes a
    // tab strip crushed into a 168px column.
    expect(read('components/shell/ShellPanel.tsx')).toContain('orientation="vertical"');
  });

  it('#6 a locked destination is visible and disabled, never hidden', () => {
    renderIndex(
      <DestinationIndex
        ariaLabel="Sub-views"
        activeId=""
        items={[item('a'), { ...item('b'), locked: true, lockedReason: 'Requires Pro' }]}
      />,
    );
    const locked = screen.getByText('b').closest('.ui-index__item');
    expect(locked).not.toBeNull();
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).toHaveAttribute('title', 'Requires Pro');
    // Disabled, not a link: it must not navigate.
    expect(locked?.tagName.toLowerCase()).not.toBe('a');
  });

  it('self-hides for a single destination, so no caller has to gate it', () => {
    const { container } = renderIndex(<DestinationIndex items={[item('only')]} activeId="only" ariaLabel="Sub-views" />);
    expect(container.querySelector('.ui-index')).toBeNull();
  });

  /**
   * §3.4 — a destination inside a panel must be able to measure the PANEL.
   *
   * The panel is 440 or 660px wide inside a window that is routinely 2560px, so
   * a route that reaches for `@media (max-width: …)` asks the wrong question and
   * lays itself out for a screen it does not have. The size container is what
   * makes the right question answerable, and it lives in the primitive so no
   * destination has to remember to establish one. jsdom does not implement
   * container queries, so this asserts the seam rather than the reflow: the body
   * carries the class, and the class declares the container.
   */
  it('§3.4 the panel body is a named size container, not a viewport reader', () => {
    const panel = read('components/SlideOutPanel.tsx');
    expect(panel).toContain('className="ui-panel-body"');
    // …and never re-inlines the sizing it used to hand-roll here.
    expect(panel).not.toContain("style={{ flex: 1, overflow: 'auto', minWidth: 0, minHeight: 0 }}");

    const css = read('app/globals.css');
    const rule = /\.ui-panel-body\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('container-type: inline-size');
    expect(rule).toContain('container-name: panel');
    // Containment replaces the flex sizing, so the body must restate it or the
    // destination collapses to its content height inside the drawer.
    expect(rule).toContain('overflow: auto');
    expect(rule).toContain('min-width: 0');
  });
});
