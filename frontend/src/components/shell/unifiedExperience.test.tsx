import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { DestinationIndex, INDEX_ROW_LIMIT, resolveOrientation, type IndexItem } from './DestinationIndex';
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

  it('#3 above the row limit the index turns vertical, so no bar holds seven', () => {
    expect(resolveOrientation('auto', INDEX_ROW_LIMIT)).toBe('horizontal');
    expect(resolveOrientation('auto', INDEX_ROW_LIMIT + 1)).toBe('vertical');

    const many = Array.from({ length: 14 }, (_, i) => item(`t${i}`));
    const { container } = renderIndex(<DestinationIndex items={many} activeId="t0" ariaLabel="Sub-views" />);
    expect(container.querySelector('.ui-index')?.getAttribute('data-orientation')).toBe('vertical');
  });

  it('#3 a short set stays a compact row', () => {
    const few = Array.from({ length: 4 }, (_, i) => item(`t${i}`));
    const { container } = renderIndex(<DestinationIndex items={few} activeId="t0" ariaLabel="Sub-views" />);
    expect(container.querySelector('.ui-index')?.getAttribute('data-orientation')).toBe('horizontal');
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
});
