#!/usr/bin/env node
/** Prevent the retired BurnRateOS host seam from returning to runtime code. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..', '..');
const roots = ['api/src', 'frontend/src'];
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs']);
const forbidden = [
  { label: 'legacy host BI configuration', pattern: /\bhostBi\b/ },
  { label: 'retired host BI endpoint', pattern: /\/api\/bi\/config\b/ },
  { label: 'BurnRateOS network URL', pattern: /https?:\/\/[^\s'"`]*burnrateos\.com\/(?:api|v1)\b/i },
];

function filesUnder(path) {
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    if (name === 'node_modules' || name === 'dist' || name === '.next') return [];
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

const violations = [];
for (const root of roots) {
  for (const file of filesUnder(resolve(repo, root))) {
    if (!extensions.has(extname(file)) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of forbidden) {
        if (rule.pattern.test(line)) violations.push(`${relative(repo, file)}:${index + 1} ${rule.label}`);
      }
    });
  }
}

if (violations.length) {
  console.error('BurnRateOS runtime dependency check failed:');
  violations.forEach((violation) => console.error(`  - ${violation}`));
  process.exit(1);
}

console.log('BurnRateOS runtime dependency check passed: no host config or network API URL in runtime source.');
