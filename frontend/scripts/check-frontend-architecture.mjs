#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../src');
const baseline = JSON.parse(readFileSync(resolve(here, '.frontend-architecture-baseline.json'), 'utf8'));

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = collect(src);
const source = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
const rel = (file) => relative(src, file).split('\\').join('/');
const production = files.filter((file) => !/\.(?:test|spec)\.tsx?$/.test(file));
const client = files.filter((file) => /^\s*['"]use client['"];/.test(source.get(file)));
const clientPages = client.filter((file) => /(?:^|\/)app\/.*\/page\.tsx$/.test(rel(file)) || rel(file) === 'app/page.tsx');
const presentationInfrastructureImports = production
  .filter((file) => /^(?:app|components)\//.test(rel(file)))
  .filter((file) => /from\s+['"]@\/infrastructure\//.test(source.get(file)))
  .map(rel);
const directEngineConstruction = production
  .filter((file) => /^(?:app|components)\//.test(rel(file)))
  .filter((file) => /new\s+(?:WebGPUTrainer|MambaEngine|MambaModelProvider)\s*\(/.test(source.get(file)))
  .map(rel);
const oversizedProductionFiles = production
  .filter((file) => source.get(file).split(/\r?\n/).length > 800)
  .filter((file) => rel(file) !== 'lib/content.ts')
  .map(rel);

const violations = [];
function ratchetCount(label, actual, maximum) {
  if (actual > maximum) violations.push(`${label}: ${actual} exceeds baseline ${maximum}`);
}
function ratchetSet(label, actual, allowed) {
  const permitted = new Set(allowed);
  for (const item of actual) if (!permitted.has(item)) violations.push(`${label}: new violation ${item}`);
}

ratchetCount("'use client' files", client.length, baseline.useClientFiles);
ratchetCount("client-rooted pages", clientPages.length, baseline.useClientPages);
ratchetSet('presentation -> infrastructure', presentationInfrastructureImports, baseline.presentationInfrastructureImports);
ratchetSet('presentation engine construction', directEngineConstruction, baseline.directEngineConstruction);
ratchetSet('production files over 800 lines', oversizedProductionFiles, baseline.oversizedProductionFiles);

if (violations.length) {
  console.error('❌  Frontend architecture ratchet failed:\n\n  - ' + violations.join('\n  - '));
  process.exit(1);
}
console.log(`✅  Frontend architecture ratchet passed (${client.length} client files, ${clientPages.length} client pages, ${oversizedProductionFiles.length} grandfathered large files).`);
