import { describe, expect, it } from 'vitest';
import { hasControlChar, isCleanKey, isCleanText, isWellFormedString } from './packKeyGuard.js';

describe('packKeyGuard', () => {
    it('refuses control characters and lone surrogates in keys, not astral pairs', () => {
        expect(hasControlChar('a\u0000b')).toBe(true);
        expect(isCleanKey('src/ok.ts')).toBe(true);
        expect(isCleanKey('src/\u{1F600}.ts')).toBe(true);
        expect(isCleanKey('src/\uD800.ts')).toBe(false);
        expect(isCleanKey('src/\uDC00x.ts')).toBe(false);
        expect(isCleanKey('src/\u0001.ts')).toBe(false);
        expect(isWellFormedString('😀')).toBe(true);
    });

    it('lets text keep newlines and tabs but refuses NUL and lone surrogates', () => {
        expect(isCleanText('line one\n\tline two')).toBe(true);
        expect(isCleanText('a\u0000b')).toBe(false);
        expect(isCleanText('a\uD800')).toBe(false);
    });
});
