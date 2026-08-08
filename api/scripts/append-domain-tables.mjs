#!/usr/bin/env node
/**
 * Append a block of target-schema tables to an existing domain module, unioning
 * the Drizzle builders it needs into that module's existing `drizzle-orm/pg-core`
 * import (PRD 20 §5 step 2).
 *
 *   node scripts/append-domain-tables.mjs growth scripts/domain-tables/growth.ts.part
 *
 * The alternative — a second `import { … } from 'drizzle-orm/pg-core'` at the
 * bottom of the file — is legal ESM and unreadable, and it makes the module's
 * dependency list two things to keep in step instead of one. Idempotent: a block
 * whose marker is already present is not appended twice.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const schemaDir = resolve(here, '..', 'src', 'infrastructure', 'database', 'schema');

const [moduleName, partPath] = process.argv.slice(2);
if (!moduleName || !partPath) {
  console.error('usage: append-domain-tables.mjs <schema-module> <part-file>');
  process.exit(1);
}

const target = resolve(schemaDir, `${moduleName}.ts`);
const part = resolve(here, '..', partPath);
if (!existsSync(target) || !existsSync(part)) {
  console.error(`❌  Missing ${!existsSync(target) ? target : part}`);
  process.exit(1);
}

const MARKER = `// ═══ PRD 20 §5 step 2 — target-schema tables ═══`;
let text = readFileSync(target, 'utf8');
const block = readFileSync(part, 'utf8');

if (text.includes(MARKER)) {
  console.log(`ℹ️   ${moduleName}.ts already carries its target-schema block.`);
  process.exit(0);
}

/** Builders the block uses, so the union is derived rather than maintained. */
const BUILDERS = [
  'bigint', 'bigserial', 'boolean', 'date', 'doublePrecision', 'index', 'integer',
  'jsonb', 'numeric', 'pgTable', 'real', 'serial', 'smallint', 'text', 'time',
  'timestamp', 'uniqueIndex', 'uuid', 'varchar',
];
const used = BUILDERS.filter((b) => new RegExp(`(?<![\\w.])${b}\\s*\\(`).test(block));

const importRe = /import\s*\{([\s\S]*?)\}\s*from\s*'drizzle-orm\/pg-core';/;
const m = text.match(importRe);
if (!m) {
  console.error(`❌  ${moduleName}.ts has no drizzle-orm/pg-core import to extend.`);
  process.exit(1);
}
const have = new Set(m[1].split(',').map((s) => s.trim()).filter(Boolean));
const next = [...new Set([...have, ...used])].sort();
text = text.replace(importRe, `import {\n  ${next.join(',\n  ')},\n} from 'drizzle-orm/pg-core';`);

/** `objects` is the registry every domain references; add the kernel import if the
 *  block uses it and the module does not already carry one. */
if (/=>\s*objects\.id/.test(block) && !/from\s*'\.\/kernel'/.test(text)) {
  text = text.replace(importRe, (s) => `${s}\nimport { objects } from './kernel';`);
} else if (/=>\s*objects\.id/.test(block) && !/\bobjects\b[^\n]*from\s*'\.\/kernel'/.test(text)) {
  text = text.replace(/import\s*\{([^}]*)\}\s*from\s*'\.\/kernel';/, (s, names) =>
    `import { ${[...new Set([...names.split(',').map((x) => x.trim()).filter(Boolean), 'objects'])].sort().join(', ')} } from './kernel';`);
}

writeFileSync(target, `${text.trimEnd()}\n\n${MARKER}\n${block.trimEnd()}\n`);
console.log(`✅  ${moduleName}.ts — appended ${(block.match(/pgTable\(/g) ?? []).length} table(s); pg-core import now ${next.length} builder(s).`);
