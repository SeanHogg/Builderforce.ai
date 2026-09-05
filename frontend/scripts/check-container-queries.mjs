#!/usr/bin/env node
/**
 * A container query cannot style its own container.
 *
 * `@container <name> (…)` matches DESCENDANTS of the element carrying
 * `container-name: <name>`. Point one at the container itself and the rule is
 * not invalid CSS, does not warn, and never applies — which is how the panel
 * layout shipped a phone dashboard with a header, a tab strip and no content:
 *
 *     .slide-panel-body-row { container-name: slide-panel; display: flex }
 *     @container slide-panel (max-width: 560px) {
 *       .slide-panel-body-row { flex-direction: column }   ← never matched
 *       .slide-panel-index    { width: 100% }              ← DID match
 *     }
 *
 * The row stayed horizontal while the index beside it took the full width, so
 * the body was laid out 0px wide with all of its content still in the DOM. The
 * half that worked is what makes this worth a guard rather than a code review
 * note: the failure looks like a layout bug in a component nobody touched, and
 * the broken selector is sitting three lines above the working one.
 *
 * The fix is always the same shape — declare the container on the ANCESTOR that
 * the query is really asking about (here, the drawer) — so the guard names it
 * in the failure rather than only reporting the smell.
 *
 * Scope: every stylesheet under `src` (globals plus CSS modules). Run via
 * `npm run check:container-queries`; wired into `npm test` via checks.manifest.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');

/** Every `.css` under `src`, as absolute paths. */
function cssFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

/**
 * The selectors a rule targets, as the individual compound selectors that decide
 * WHICH element is styled — the rightmost part of each comma-separated branch.
 * `.a .b, .c > .d` styles `.b` and `.d`; whether `.a` is an ancestor is exactly
 * the question the container is answering, so only the subject matters here.
 */
function subjects(selectorList) {
  return selectorList
    .split(',')
    .map((branch) => branch.trim().split(/\s+|(?=>)|(?<=>)/).filter(Boolean).pop() ?? '')
    .map((subject) => subject.replace(/^[>+~]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Class names a compound selector requires, so `.slide-panel-index:has(> .x)`
 * and `.slide-panel-index` compare equal on the part that names the element.
 * A pseudo-class narrows a selector; it never moves it to a different element.
 */
function classesOf(compound) {
  return new Set((compound.replace(/:[a-z-]+\([^)]*\)/gi, '').match(/\.[A-Za-z0-9_-]+/g) ?? []));
}

const violations = [];

for (const file of cssFiles(srcDir)) {
  const css = readFileSync(file, 'utf8');
  const rel = relative(resolve(here, '..'), file).split('\\').join('/');

  // Which selector declares each container name. A name can be declared on more
  // than one selector (different surfaces, same role), so this is a list.
  const declaredBy = new Map();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectorList, body] = match;
    const named = body.match(/container-name:\s*([A-Za-z0-9_-]+)/);
    const shorthand = body.match(/\bcontainer:\s*([A-Za-z0-9_-]+)/);
    const name = named?.[1] ?? shorthand?.[1];
    if (!name || selectorList.includes('@')) continue;
    for (const subject of subjects(selectorList)) {
      if (!declaredBy.has(name)) declaredBy.set(name, []);
      declaredBy.get(name).push({ subject, classes: classesOf(subject) });
    }
  }
  if (declaredBy.size === 0) continue;

  // Every rule inside a named `@container` block, checked against the selectors
  // that declare that name. Block bodies are matched by scanning braces rather
  // than by regex — a nested rule is the whole point of an at-rule.
  for (const open of css.matchAll(/@container\s+([A-Za-z0-9_-]+)\s*\([^)]*\)\s*\{/g)) {
    const name = open[1];
    const declarations = declaredBy.get(name);
    if (!declarations) continue;
    let depth = 1;
    let i = open.index + open[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    const block = css.slice(start, i - 1);
    for (const rule of block.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      for (const subject of subjects(rule[1])) {
        const wanted = classesOf(subject);
        if (wanted.size === 0) continue;
        const self = declarations.find((d) => d.classes.size > 0
          && [...d.classes].every((cls) => wanted.has(cls)));
        if (self) violations.push({ rel, name, subject, container: self.subject });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('❌  A container query targets its own container — the rule can never match.\n');
  for (const { rel, name, subject, container } of violations) {
    console.error(`  - ${rel}: @container ${name} { ${subject} { … } }`);
    console.error(`      \`${container}\` IS the \`${name}\` container, and a container query`);
    console.error('      only styles its DESCENDANTS. Move `container-name` to the ancestor');
    console.error('      whose width the query is really asking about.\n');
  }
  process.exit(1);
}

console.log('✅  No container query targets its own container.');
