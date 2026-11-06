import { describe, expect, it } from 'vitest';
import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
    it('keeps whole bytes below a kilobyte and one decimal above', () => {
        expect(formatBytes(12)).toBe('12 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2.0 KB');
        expect(formatBytes(3.2 * 1024)).toBe('3.2 KB');
        expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
        expect(formatBytes(1.4 * 1024 * 1024)).toBe('1.4 MB');
    });
    it('reaches gigabytes instead of printing thousands of megabytes', () => {
        expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB');
    });
});
