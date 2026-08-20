/**
 * check-canvas-glossary — the frontend context map must stay true.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ──────────────────────────────────────────
 * PRD 22 §4.2 named four frontend "domains" that were defined nowhere. A domain
 * that is only a word in a document does not fail; it drifts, and the drift is
 * discovered by whoever next tries to reason about the code with the document in
 * hand. `check-prompt-tool-names.mjs` exists for the same class of failure on the
 * API side — a prompt naming a tool the model was never given — and it is modelled
 * on directly here: assert the PROPERTY, everywhere, rather than unit-testing one
 * instance of it.
 *
 * ── THE RULES ────────────────────────────────────────────────────────────────
 * 1. Every context declares at least one relationship, and every relationship
 *    names a context that exists (a frontend context, or one of PRD 20's backend
 *    contexts). A one-sided context map is a directory.
 * 2. Every declared `root` exists on disk. A context whose home has been moved or
 *    deleted is stale by definition.
 * 3. Every glossary TERM is spelled one way. A term that appears in the tree in a
 *    different casing (`canvasboard`, `Canvas_Board`) is the ubiquitous language
 *    coming apart, which is exactly what a context map is for.
 * 4. `CanvasCommand` is never handed to the transport. §3.7 proposed broadcasting
 *    commands to collaborators, which lets two peers legitimately reach different
 *    answers about the same change — a correctness bug. Only `CanvasEvent` crosses
 *    the wire, and this asserts it.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '..', 'src');
const mapFile = join(srcDir, 'lib', 'canvas', 'boundedContexts.ts');

const violations = [];

if (!existsSync(mapFile)) {
  console.error('❌  Canvas glossary check: src/lib/canvas/boundedContexts.ts is missing.');
  process.exit(1);
}

const mapSource = readFileSync(mapFile, 'utf8');

// The map is data, but this guard must not import TypeScript — parse the two
// literal blocks it needs. Deliberately narrow: a shape this cannot read is a
// shape the map should not have grown.
const backendIds = [...(mapSource.match(/export const BACKEND_CONTEXTS = \[([\s\S]*?)\] as const;/)?.[1] ?? '')
  .matchAll(/'([a-zA-Z][\w-]*)'/g)].map((m) => m[1]);

const contextsBlock = mapSource.match(/export const FRONTEND_CONTEXTS[\s\S]*?\n\] as const;/)?.[0] ?? '';
const contexts = [];
for (const chunk of contextsBlock.split(/\n  \{\n/).slice(1)) {
  const id = chunk.match(/id: '([^']+)'/)?.[1];
  if (!id) continue;
  const terms = [...(chunk.match(/terms: \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const roots = [...(chunk.match(/roots: \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const relations = [...chunk.matchAll(/with: '([^']+)',\s*\n\s*kind: '([^']+)',\s*\n\s*why: '([^']*)'/g)]
    .map((m) => ({ with: m[1], kind: m[2], why: m[3] }));
  contexts.push({ id, terms, roots, relations });
}

if (contexts.length === 0) violations.push('the context map parsed to zero contexts — the shape this guard reads has changed');

const known = new Set([...contexts.map((c) => c.id), ...backendIds]);

for (const context of contexts) {
  if (context.relations.length === 0) {
    violations.push(`context '${context.id}' declares no relationship — a context map needs both sides`);
  }
  for (const relation of context.relations) {
    if (!known.has(relation.with)) {
      violations.push(`context '${context.id}' names unknown context '${relation.with}'`);
    }
    if (!relation.why || relation.why.length < 20) {
      violations.push(`context '${context.id}' -> '${relation.with}' has no stated reason`);
    }
  }
  for (const root of context.roots) {
    if (!existsSync(join(srcDir, root))) {
      violations.push(`context '${context.id}' declares root '${root}', which does not exist`);
    }
  }
  if (context.terms.length === 0) {
    violations.push(`context '${context.id}' owns no vocabulary`);
  }
}

// ── the tree ─────────────────────────────────────────────────────────────────
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
})(srcDir);

const terms = [...new Set(contexts.flatMap((c) => c.terms))];

/**
 * Only COMPOUND terms are casing-checked.
 *
 * `Model`, `Run`, `Route` and `Voice` are ubiquitous language AND ordinary
 * English, so a lowercase `route` is a local variable, not drift — flagging it
 * would make this guard noise and noise is how a guard gets disabled. A compound
 * like `CanvasBoard` has no such excuse: `canvasboard` or `canvas_board` in this
 * tree IS the language coming apart, since nothing else spells it that way.
 */
const isCompound = (term) => (term.match(/[A-Z]/g) ?? []).length > 1;

/** Casing variants that mean the same term and are therefore drift. */
const variantsOf = (term) => [
  term.toLowerCase(),
  term.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(),
  term.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
].filter((variant) => variant !== term.toLowerCase() || variant !== term);

for (const file of files) {
  const rel = relative(srcDir, file).split('\\').join('/');
  if (rel === 'lib/canvas/boundedContexts.ts' || /\.test\.tsx?$/.test(rel)) continue;
  const source = readFileSync(file, 'utf8');
  // Comments are prose, and prose hyphenates. `check-prompt-tool-names.mjs` is
  // literal-only for the same reason: a doc comment writing "the canvas-object
  // shape" is English, not the language coming apart. Only CODE is checked.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ 	]*\/\/.*$/gm, ' ');

  for (const term of terms) {
    if (!isCompound(term)) continue;
    for (const variant of new Set(variantsOf(term))) {
      // Identifier boundaries only: `canvasboard` inside `mycanvasboardx` is not
      // this term, and a CSS class or a URL slug is not the language either.
      const pattern = new RegExp(`(?<![\\w$'"\`/-])${variant}(?![\\w$'"\`/-])`);
      if (pattern.test(code)) {
        violations.push(`${rel}: spells '${term}' as '${variant}'`);
      }
    }
  }

  // Rule 4 — commands never reach the transport.
  if (/broadcastableCanvasChange\s*\(\s*(?:command|cmd)\b/.test(source)
    || /broadcast\w*\s*\([^)]*\bCanvasCommand\b/.test(source)) {
    violations.push(`${rel}: broadcasts a CanvasCommand — only a CanvasEvent may cross the wire`);
  }
}

if (violations.length > 0) {
  console.error(`❌  Canvas glossary / context map (${violations.length} problem(s)):\n`);
  for (const violation of violations) console.error('  - ' + violation);
  console.error(
    '\n   The map is src/lib/canvas/boundedContexts.ts. Either spell the term the way'
    + '\n   its context spells it, or change the context — but not one without the other.\n',
  );
  process.exit(1);
}

console.log(
  `✅  Canvas glossary check passed — ${contexts.length} frontend contexts, `
  + `${terms.length} terms, every relationship declared, no command on the wire.`,
);
