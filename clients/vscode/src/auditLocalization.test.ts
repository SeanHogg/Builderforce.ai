import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const manifest = read('package.json');

describe('audit settings localization', () => {
  it.each(['', '.de', '.es', '.fr', '.zh-cn'])('resolves every audit setting key in %s', (locale) => {
    const catalog = read(`package.nls${locale}.json`);
    for (const [name, value] of Object.entries(manifest.contributes.configuration.properties)) {
      if (!name.startsWith('builderforce.audits.')) continue;
      const key = (value as { description: string }).description.replace(/^%|%$/g, '');
      expect(catalog[key], `${locale}: ${key}`).toBeTruthy();
    }
  });
  it.each(['', '.de', '.es', '.fr', '.zh-cn'])('resolves audit UI copy in %s', (locale) => {
    const catalog = read(`l10n/bundle.l10n${locale}.json`);
    const source = ['auditExecution.ts', 'systemAuditApi.ts'].map((file) => readFileSync(new URL(`src/${file}`, root), 'utf8')).join('\n');
    for (const match of source.matchAll(/vscode\.l10n\.t\('([^']+)'/g)) expect(catalog[match[1]!], match[1]).toBeTruthy();
    expect(catalog['Remediation tickets']).toBeTruthy();
    expect(catalog['Audit preview. Source review is pending.']).toBeTruthy();
    expect(catalog['Audit source review completed.']).toBeTruthy();
  });
});
