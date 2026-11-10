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

/** A pdf.js document whose pages hold `pages`. */
function fakePdf(pages: string[], hooks: { onPage?: (n: number) => void } = {}) {
    return {
        numPages: pages.length,
        getPage: async (n: number) => {
            hooks.onPage?.(n);
            return { getTextContent: async () => ({ items: [{ str: pages[n - 1], hasEOL: false }] }) };
        },
    };
}

/**
 * unpdf's resolved pdf.js, mocked: `getDocument` returns a LOADING TASK whose promise is `open(data)` and whose
 * `destroy` is the spy. PDFDocumentProxy has no destroy(): the document is released through its loading task.
 */
function mockPdfjs(open: (data: Uint8Array) => Promise<unknown>, destroy: () => void = () => {}) {
    vi.doMock('unpdf', () => ({
        getResolvedPDFJS: async () => ({
            getDocument: ({ data }: { data: Uint8Array }) => ({ promise: open(data), destroy: async () => destroy() }),
        }),
    }));
}

describe('extractDocumentText: pdf engine', () => {
    it('throws, rather than returning undefined, when the pdf engine fails to load', async () => {
        vi.doMock('unpdf', () => { throw new Error('chunk load failed'); });
        const { extractDocumentText } = await load();
        await expect(extractDocumentText(new Uint8Array(4), PDF)).rejects.toThrow();
    });

    it('returns undefined for a malformed pdf (final failure)', async () => {
        mockPdfjs(async () => { throw Object.assign(new Error('Invalid PDF structure'), { name: 'InvalidPDFException' }); });
        const { extractDocumentText, readDocument } = await load();
        expect(await extractDocumentText(new Uint8Array(4), PDF)).toBeUndefined();
        expect(await readDocument(new Uint8Array(4), PDF)).toEqual({ failure: 'unreadable', reason: 'Invalid PDF structure' });
    });

    it('treats a RangeError raised while parsing as unreadable, not transient', async () => {
        mockPdfjs(async () => { throw new RangeError('Invalid typed array length'); });
        const { readDocument } = await load();
        expect(await readDocument(new Uint8Array(4), PDF)).toEqual({ failure: 'unreadable', reason: 'Invalid typed array length' });
    });

    it('regression: destroys the loading task when a malformed pdf fails to open (no leaked transport)', async () => {
        const destroy = vi.fn();
        mockPdfjs(async () => { throw Object.assign(new Error('Invalid PDF structure'), { name: 'InvalidPDFException' }); }, destroy);
        const { readDocument } = await load();
        expect(await readDocument(new Uint8Array(4), PDF)).toEqual({ failure: 'unreadable', reason: 'Invalid PDF structure' });
        expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('hands pdf.js a private copy of the bytes', async () => {
        let given: Uint8Array | undefined;
        mockPdfjs(async (data) => { given = data; return fakePdf(['one']); });
        const { extractDocumentText } = await load();
        const bytes = new Uint8Array([1, 2, 3, 4]);
        await extractDocumentText(bytes, PDF);
        expect(given).toEqual(bytes);
        expect(given?.buffer).not.toBe(bytes.buffer);
    });

    it('stops between pages when aborted, and still destroys the document', async () => {
        const controller = new AbortController();
        const destroy = vi.fn();
        const pdf = fakePdf(['one', 'two', 'three'], { onPage: (n) => { if (n === 1) controller.abort(new Error('stop now')); } });
        mockPdfjs(async () => pdf, destroy);
        const { extractDocumentText } = await load();
        await expect(extractDocumentText(new Uint8Array(4), PDF, controller.signal)).rejects.toThrow('stop now');
        expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('destroys the document after a normal read', async () => {
        const destroy = vi.fn();
        mockPdfjs(async () => fakePdf(['one', 'two']), destroy);
        const { extractDocumentText } = await load();
        expect(await extractDocumentText(new Uint8Array(4), PDF)).toBe('one\ntwo');
        expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('regression: caps the text on a code-point boundary, never leaving a lone surrogate half', async () => {
        const { DEFAULT_MAX_FILE_BYTES } = await import('@seanhogg/builderforce-memory/knowledge');
        // An emoji (a surrogate pair) straddling the cap: a plain slice would keep only its high half.
        const page = `${'a'.repeat(DEFAULT_MAX_FILE_BYTES - 1)}\u{1F600}tail`;
        mockPdfjs(async () => fakePdf([page]));
        const { readDocument } = await load();
        const read = await readDocument(new Uint8Array(4), PDF);
        const text = 'text' in read ? read.text : '';
        expect(text.length).toBe(DEFAULT_MAX_FILE_BYTES - 1);
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text)).toBe(false);
    });

    it('destroys the REAL pdf.js loading task after extraction', async () => {
        const tasks: Array<{ destroyed: boolean }> = [];
        vi.doMock('unpdf', async (importOriginal) => {
            const real = await importOriginal<typeof import('unpdf')>();
            return {
                ...real,
                getResolvedPDFJS: async () => {
                    const pdfjs = await real.getResolvedPDFJS();
                    return {
                        ...pdfjs,
                        getDocument: (...args: Parameters<typeof pdfjs.getDocument>) => {
                            const task = pdfjs.getDocument(...args);
                            tasks.push(task);
                            return task;
                        },
                    };
                },
            };
        });
        const { extractDocumentText } = await load();
        expect(await extractDocumentText(tinyPdf('Hello PDF'), PDF)).toContain('Hello PDF');
        expect(tasks).toHaveLength(1);
        expect(tasks[0]?.destroyed).toBe(true);
    });
});
