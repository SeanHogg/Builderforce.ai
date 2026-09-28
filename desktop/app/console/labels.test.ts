import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildEvermindLabelBundles, readEvermindKeys } from './labels';

const VSCODE = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../clients/vscode');

describe('Evermind console labels', () => {
  it('reads the ev.* literals, unescaping them', () => {
    expect(readEvermindKeys(`"ev.a": t("Say \\"hi\\""),\n    "ev.b": t("Learning · v{version}"),\n    "other": t("x"),`)).toEqual([
      ['ev.a', 'Say "hi"'],
      ['ev.b', 'Learning · v{version}'],
    ]);
  });

  it('derives all five locales from the extension, with the four working tabs translated', () => {
    const { bundles } = buildEvermindLabelBundles(VSCODE);
    expect(Object.keys(bundles).sort()).toEqual(['de', 'en', 'es', 'fr', 'zh']);
    expect(bundles.en['ev.tabTeach']).toBe('Teach');
    for (const locale of ['de', 'es', 'fr', 'zh']) {
      expect(bundles[locale]['ev.tabMaintain'], locale).not.toBe('Maintain');
      expect(Object.keys(bundles[locale])).toEqual(Object.keys(bundles.en));
    }
  });
});
