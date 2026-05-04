import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const sdkFile = resolve(here, '../src/domain/aiUseCases.ts');
const apiFile = resolve(here, '../../api/src/application/llm/aiUseCases.ts');

function extractQuotedValues(segment) {
  const matches = segment.matchAll(/'([^']+)'/g);
  return [...matches].map((m) => m[1]);
}

function extractSdkUseCases(fileText) {
  const match = fileText.match(/export const AI_USE_CASES\s*=\s*\[([\s\S]*?)\]\s*as const;/);
  if (!match) throw new Error('Could not locate SDK AI_USE_CASES array');
  return extractQuotedValues(match[1]);
}

function extractApiUseCases(fileText) {
  const match = fileText.match(/export type AIUseCase\s*=\s*([\s\S]*?);/);
  if (!match) throw new Error('Could not locate API AIUseCase union');
  return extractQuotedValues(match[1]);
}

function formatDiff(expected, actual) {
  const out = [];
  const max = Math.max(expected.length, actual.length);
  for (let i = 0; i < max; i++) {
    if (expected[i] !== actual[i]) {
      out.push(`  [${i}] api="${expected[i] ?? '<missing>'}" sdk="${actual[i] ?? '<missing>'}"`);
    }
  }
  return out.join('\n');
}

const sdk = extractSdkUseCases(readFileSync(sdkFile, 'utf8'));
const api = extractApiUseCases(readFileSync(apiFile, 'utf8'));

if (sdk.length !== api.length || sdk.some((v, i) => api[i] !== v)) {
  console.error('AI use-case lists are out of sync between API and SDK:\n');
  console.error(formatDiff(api, sdk));
  process.exit(1);
}

console.log(`AI use-case sync check passed (${sdk.length} use cases).`);
