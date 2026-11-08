import { afterEach, describe, expect, it, vi } from 'vitest';
import { tinyPdf } from './documentText.fixtures.test-util.js';

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

/** PDFDocumentProxy has no destroy(): the document is released through its loading task. */
function fakePdf(pages: string[], hooks: { onPage?: (n: number) => void; destroy?: () => void } = {}) {
    return {
        numPages: pages.length,
        getPage: async (n: number) => {
            hooks.onPage?.(n);
            return { getTextContent: async () => ({ items: [{ str: pages[n - 1], hasEOL: false }] }) };
        },
        loadingTask: { destroy: async () => hooks.destroy?.() },
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
        const { extractDocumentText, readDocument } = await load();
        expect(await extractDocumentText(new Uint8Array(4), PDF)).toBeUndefined();
        expect(await readDocument(new Uint8Array(4), PDF)).toEqual({ failure: 'unreadable', reason: 'Invalid PDF structure' });
    });

    it('treats a RangeError raised while parsing as unreadable, not transient', async () => {
        vi.doMock('unpdf', () => ({ getDocumentProxy: async () => { throw new RangeError('Invalid typed array length'); } }));
        const { readDocument } = await load();
        expect(await readDocument(new Uint8Array(4), PDF)).toEqual({ failure: 'unreadable', reason: 'Invalid typed array length' });
    });

    it('hands pdf.js a private copy of the bytes', async () => {
        let given: Uint8Array | undefined;
        vi.doMock('unpdf', () => ({ getDocumentProxy: async (data: Uint8Array) => { given = data; return fakePdf(['one']); } }));
        const { extractDocumentText } = await load();
        const bytes = new Uint8Array([1, 2, 3, 4]);
        await extractDocumentText(bytes, PDF);
        expect(given).toEqual(bytes);
        expect(given?.buffer).not.toBe(bytes.buffer);
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

    it('destroys the REAL pdf.js loading task after extraction', async () => {
        let opened: Awaited<ReturnType<typeof import('unpdf').getDocumentProxy>> | undefined;
        vi.doMock('unpdf', async (importOriginal) => {
            const real = await importOriginal<typeof import('unpdf')>();
            return {
                ...real,
                getDocumentProxy: async (...args: Parameters<typeof real.getDocumentProxy>) => {
                    opened = await real.getDocumentProxy(...args);
                    return opened;
                },
            };
        });
        const { extractDocumentText } = await load();
        expect(await extractDocumentText(tinyPdf('Hello PDF'), PDF)).toContain('Hello PDF');
        expect(opened?.loadingTask.destroyed).toBe(true);
    });
});
