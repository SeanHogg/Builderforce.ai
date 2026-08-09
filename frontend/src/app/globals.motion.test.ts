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

  it('keeps the Product panel centered in both its resting and open states', () => {
    expect(css).toMatch(/\.mh-panel-wide\s*\{[^}]*transform:\s*translateX\(-50%\)\s+translateY\(8px\)/s);
    expect(css).toMatch(/\.mh-item\.has-menu:hover \.mh-panel-wide,[^{]*\{[^}]*transform:\s*translateX\(-50%\)\s+translateY\(0\)/s);
  });
});
