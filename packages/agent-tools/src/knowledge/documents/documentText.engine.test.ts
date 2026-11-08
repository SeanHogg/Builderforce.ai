import { afterEach, describe, expect, it, vi } from 'vitest';

/** The pdf.js engine is mocked per test, so the module under test is re-imported fresh each time. */
async function load() {
    vi.resetModules();
    return import('./documentText.js');
}

afterEach(() => {
    vi.doUnmock('unpdf');
    vi.resetModules();
});

const PDF = 'application/pdf';

function fakePdf(pages: string[], hooks: { onPage?: (n: number) => void; destroy?: () => void } = {}) {
    return {
        numPages: pages.length,
        getPage: async (n: number) => {
            hooks.onPage?.(n);
            return { getTextContent: async () => ({ items: [{ str: pages[n - 1], hasEOL: false }] }) };
        },
        destroy: async () => hooks.destroy?.(),
    };
}

describe('extractDocumentText: pdf engine', () => {
    it('throws, rather than returning undefined, when the pdf engine fails to load', async () => {
        vi.doMock('unpdf', () => { throw new Error('chunk load failed'); });
        const { extractDocumentText } = await load();
        await expect(extractDocumentText(new Uint8Array(4), PDF)).rejects.toThrow();
    });

    it('returns undefined for a malformed pdf (final failure)', async () => {
        vi.doMock('unpdf', () => ({ getDocumentProxy: async () => { throw Object.assign(new Error('Invalid PDF structure'), { name: 'InvalidPDFException' }); } }));
        const { extractDocumentText } = await load();
        expect(await extractDocumentText(new Uint8Array(4), PDF)).toBeUndefined();
    });

    it('rethrows an out-of-memory RangeError', async () => {
        vi.doMock('unpdf', () => ({ getDocumentProxy: async () => { throw new RangeError('Array buffer allocation failed'); } }));
        const { extractDocumentText } = await load();
        await expect(extractDocumentText(new Uint8Array(4), PDF)).rejects.toBeInstanceOf(RangeError);
    });

    it('stops between pages when aborted, and still destroys the document', async () => {
        const controller = new AbortController();
        const destroy = vi.fn();
        const pdf = fakePdf(['one', 'two', 'three'], { onPage: (n) => { if (n === 1) controller.abort(new Error('stop now')); }, destroy });
        vi.doMock('unpdf', () => ({ getDocumentProxy: async () => pdf }));
        const { extractDocumentText } = await load();
        await expect(extractDocumentText(new Uint8Array(4), PDF, controller.signal)).rejects.toThrow('stop now');
        expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('destroys the document after a normal read', async () => {
        const destroy = vi.fn();
        vi.doMock('unpdf', () => ({ getDocumentProxy: async () => fakePdf(['one', 'two'], { destroy }) }));
        const { extractDocumentText } = await load();
        expect(await extractDocumentText(new Uint8Array(4), PDF)).toBe('one\ntwo');
        expect(destroy).toHaveBeenCalledTimes(1);
    });
});
