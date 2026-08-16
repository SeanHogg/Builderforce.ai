import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The DOM half of `setup.ts` is loaded only where there IS a DOM, and this is
 * the assertion that keeps that safe.
 *
 * `setupFiles` runs per test FILE, so an eager import there is paid by all 157
 * `src/lib` files — 134 of which run in `node` under the project split and have
 * no document. That cost is not only slow: starting a worker means loading the
 * setup file, and vitest's worker start budget is a HARD-CODED 60s constant with
 * no config lever, so a jsdom-overriding file at the tail of a contended run
 * could go over it and be reported as `Failed to start threads worker` — a
 * failure indistinguishable from a hang in the code under test.
 *
 * The gate is only sound while no node-environment test uses a matcher that
 * `@testing-library/jest-dom` registers. That is a property of 134 files, which
 * is exactly the kind of thing a comment cannot hold, so it is asserted here: a
 * new `src/lib` test reaching for `toBeInTheDocument` fails HERE, naming the
 * file and the one-line fix, rather than failing with "not a function" wherever
 * the scheduler happens to run it.
 */

const LIB = join(process.cwd(), 'src', 'lib');

/** Matchers that exist only because jest-dom registered them. */
const DOM_MATCHER = /\.(toBeInTheDocument|toBeVisible|toHaveTextContent|toHaveClass|toHaveAttribute|toHaveValue|toHaveStyle|toBeDisabled|toBeEnabled|toBeChecked|toHaveFocus|toBeEmptyDOMElement|toHaveAccessibleName)\b/;

/** A file opting itself into a document, which is what earns it the matchers. */
const DECLARES_JSDOM = /@vitest-environment\s+jsdom/;

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('test setup — the DOM half is gated on there being a DOM', () => {
  it('no node-environment lib test uses a jest-dom matcher', () => {
    const offenders = testFiles(LIB)
      .map((file) => ({ file, text: readFileSync(file, 'utf8') }))
      .filter(({ text }) => !DECLARES_JSDOM.test(text) && DOM_MATCHER.test(text))
      .map(({ file }) => relative(process.cwd(), file).split('\\').join('/'));

    expect(
      offenders,
      'These run in the `node` project, where jest-dom is deliberately not loaded. '
      + 'Add `// @vitest-environment jsdom` as the first line — the same docblock the '
      + '23 lib tests that need a document already carry.',
    ).toEqual([]);
  });

  it('the setup file loads the DOM matchers behind a document check', () => {
    const setup = readFileSync(join(process.cwd(), 'src', 'test', 'setup.ts'), 'utf8');
    // A top-level `import '@testing-library/jest-dom'` would be eager again, and
    // the cost would come back with no test failing to say so.
    expect(setup).not.toMatch(/^import ['"]@testing-library\/jest-dom/m);
    expect(setup).toMatch(/typeof document !== 'undefined'/);
  });
});
