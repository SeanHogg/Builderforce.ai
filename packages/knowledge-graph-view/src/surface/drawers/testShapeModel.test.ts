import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../../testing';
import { coverageConfigModel, packageOfPath } from './coverageConfigModel';
import { isTestPath, testShapeModel, testShapeOf, testShapeOfPaths } from './testShapeModel';

describe('test shape', () => {
    it('recognises test files by name and folder', () => {
        expect(isTestPath('src/a.test.ts')).toBe(true);
        expect(isTestPath('src/__tests__/a.ts')).toBe(true);
        expect(isTestPath('pkg/test_a.py')).toBe(true);
        expect(isTestPath('src/a.ts')).toBe(false);
        expect(isTestPath('src/testing.ts')).toBe(false);
    });
    it('classifies by path convention, unit by default', () => {
        expect(testShapeOf('src/a.test.ts')).toBe('unit');
        expect(testShapeOf('e2e/login.spec.ts')).toBe('e2e');
        expect(testShapeOf('src/a.e2e.test.ts')).toBe('e2e');
        expect(testShapeOf('tests/integration/db.test.ts')).toBe('integration');
        expect(testShapeOf('src/db.integration.test.ts')).toBe('integration');
    });
    it('counts a split, and reports total 0 when there are no tests', () => {
        expect(testShapeOfPaths(['a.test.ts', 'b.test.ts', 'e2e/c.spec.ts', 'x.integration.test.ts', 'src/index.ts'])).toEqual({ unit: 2, integration: 1, e2e: 1, total: 4 });
        expect(testShapeModel(surfaceFixture()).total).toBe(0);
    });
});

describe('coverageConfigModel', () => {
    it('names the package of a path', () => {
        expect(packageOfPath('packages/foo/src/a.ts')).toBe('packages/foo');
        expect(packageOfPath('api/src/a.ts')).toBe('api');
        expect(packageOfPath('index.ts')).toBe('.');
    });
    it('separates packages with a coverage badge from those without', () => {
        const m = coverageConfigModel(surfaceFixture());
        expect(m.configured).toEqual(['api', 'db']);
        expect(m.uncovered).toEqual(['cron', 'web']);
        expect(m.packages).toBe(4);
    });
});
