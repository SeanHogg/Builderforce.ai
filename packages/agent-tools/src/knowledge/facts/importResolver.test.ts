import { describe, expect, it } from 'vitest';
import { importResolver, pythonModuleCandidates } from './importResolver.js';

const files = new Set(['src/a.ts', 'src/lib/index.ts', 'app/models.py', 'app/pkg/__init__.py', 'pkg/util.py']);
const resolve = importResolver((f) => files.has(f));

describe('importResolver (PRD 41 §B3 facts)', () => {
    it('JS/TS: relative imports to the file on disk, the TS source of a .js import, an index file; a package is undefined', () => {
        expect(resolve('src/b.ts', './a')).toBe('src/a.ts');
        expect(resolve('src/b.ts', './a.js')).toBe('src/a.ts');
        expect(resolve('src/b.ts', './lib')).toBe('src/lib/index.ts');
        expect(resolve('src/b.ts', './missing')).toBeUndefined();
        expect(resolve('src/b.ts', 'react')).toBeUndefined();
    });

    it('Python: relative imports to a module file or a package __init__; absolute imports are packages', () => {
        expect(pythonModuleCandidates('app/views.py', '.models')).toEqual(['app/models.py', 'app/models/__init__.py']);
        expect(pythonModuleCandidates('app/sub/views.py', '..models')).toEqual(['app/models.py', 'app/models/__init__.py']);
        expect(resolve('app/views.py', '.models')).toBe('app/models.py');
        expect(resolve('app/views.py', '.pkg')).toBe('app/pkg/__init__.py');
        expect(resolve('app/views.py', 'os')).toBeUndefined();
    });
});
