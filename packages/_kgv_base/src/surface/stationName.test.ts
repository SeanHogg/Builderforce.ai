import { describe, expect, it } from 'vitest';
import { clipName, isRepoConfigFile, packageNameOf, REPO_CONFIG_NAME, stationName, stationNames } from './stationName';

describe('stationName', () => {
    it('leaves a name that is not a path alone', () => {
        expect(stationName('API')).toBe('API');
        expect(stationName('(root)')).toBe('(root)');
        expect(stationName(REPO_CONFIG_NAME)).toBe(REPO_CONFIG_NAME);
    });

    it('strips the directory every station shares and keeps at most the last two segments', () => {
        const names = stationNames(['Builderforce.ai/clients/vscode/src', 'Builderforce.ai/clients/rovr/src', 'Builderforce.ai/api/src/domain']);
        expect(names).toEqual(['vscode/src', 'rovr/src', 'src/domain']);
        expect(names.join()).not.toContain('Builderforce.ai');
    });

    it('widens only the names that would read the same', () => {
        const names = stationNames(['a/x/src', 'b/x/src', 'c/y']);
        expect(new Set(names).size).toBe(3);
        expect(names[2]).toBe('c/y');
    });

    it('shortens only the group of an entry station named "group › file"', () => {
        expect(stationNames(['p/q/web › main.tsx', 'p/q/api'])[0]).toBe('web › main.tsx');
    });
});

describe('packageNameOf', () => {
    it('names a line after its package, not its container folders', () => {
        expect(packageNameOf('vscode/src')).toBe('vscode');
        expect(packageNameOf('clients/vscode/src')).toBe('vscode');
        expect(packageNameOf('Web app')).toBe('Web app');
        expect(packageNameOf('src')).toBe('src');
    });
});

describe('clipName', () => {
    it('keeps the end of a long name behind a leading "…/"', () => {
        const clipped = clipName('very/long/prefix/path/vscode/src', 14);
        expect(clipped.startsWith('…/')).toBe(true);
        expect(clipped.endsWith('vscode/src')).toBe(true);
        expect(clipped.length).toBeLessThanOrEqual(14);
        expect(clipName('short', 28)).toBe('short');
    });
});

describe('isRepoConfigFile', () => {
    it('folds root dotfiles and config, never a file in a folder or a root document', () => {
        for (const f of ['LICENSE', 'Dockerfile', '.gitattributes', 'CODEOWNERS', 'pnpm-lock.yaml']) expect(isRepoConfigFile(f), f).toBe(true);
        expect(isRepoConfigFile('src/Dockerfile')).toBe(false);
        expect(isRepoConfigFile('lease.md')).toBe(false);
    });
});
