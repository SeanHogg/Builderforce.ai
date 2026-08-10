import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf8');

describe('reduced-motion layout safety', () => {
  it('does not erase positioning transforms when an element is hovered or focused', () => {
    expect(css).not.toMatch(
      /\*:not\(\.motion-essential\)[^{]*(?::hover|:focus-visible)[^{]*\{[^}]*transform\s*:\s*none\s*!important/,
    );
  });

  /**
   * The mega panel is anchored to the marketing COLUMN, not to its trigger.
   *
   * It used to be trigger-centred (`left: 50%` + `translateX(-50%)`), and
   * because Learn ▾ sits left of centre the panel opened ~70px outside the
   * logo — the menu was the one part of the header that ignored the header's
   * own edges. Anchoring to `--marketing-gutter` on both sides means it can
   * never extend past the column, at any viewport, for any trigger position.
   */
  it('anchors the mega panel to the marketing column, never past its edges', () => {
    const wide = css.match(/\.mh-panel-wide\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(wide).toMatch(/left:\s*var\(--marketing-gutter\)/);
    expect(wide).toMatch(/right:\s*var\(--marketing-gutter\)/);
    // No horizontal transform in either state — a centring offset is exactly
    // what pushed it outside, and `left`/`right` already place it.
    expect(wide).not.toMatch(/translateX/);
    const open = css.match(/\.mh-item\.has-menu\[data-open\] \.mh-panel-wide\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(open).toMatch(/transform:\s*translateY\(0\)/);
    expect(open).not.toMatch(/translateX/);
    // The panel resolves against `.mh-inner` (the column), which only works
    // while the trigger's own containing block is dropped.
    expect(css).toMatch(/\.mh-item\.has-menu:has\(> \.mh-panel-wide\)\s*\{\s*position:\s*static/);
  });
});
