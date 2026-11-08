import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
    decodeEntities, DOCX_MEDIA_TYPE, extractDocumentText, MAX_ZIP_ENTRIES, ODT_MEDIA_TYPE, PDF_MEDIA_TYPE,
    PPTX_MEDIA_TYPE, readDocument, unzipEntries, XLSX_MEDIA_TYPE, zipEntryNames,
} from './documentText.js';
import { tinyPdf } from './documentText.fixtures.test-util.js';

const docx = (xml: string): Uint8Array => zipSync({ 'word/document.xml': strToU8(xml) });
const slide = (text: string): Uint8Array => strToU8(`<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`);

/** Overwrite the declared uncompressed size in every local (+22) and central (+24) zip header. */
function declareSize(zip: Uint8Array, size: number): Uint8Array {
    const out = zip.slice();
    const view = new DataView(out.buffer);
    for (let i = 0; i + 30 < out.length; i++) {
        const sig = view.getUint32(i, true);
        if (sig === 0x04034b50) view.setUint32(i + 22, size, true);
        else if (sig === 0x02014b50) view.setUint32(i + 24, size, true);
    }
    return out;
}


describe('extractDocumentText', () => {
    it('reads a DOCX, one line per paragraph, tabs kept', async () => {
        const xml = '<w:body><w:p><w:r><w:t>Plan</w:t></w:r><w:tab/><w:r><w:t xml:space="preserve"> A &amp; B</w:t></w:r></w:p><w:p><w:r><w:t>Ship</w:t></w:r></w:p></w:body>';
        expect(await extractDocumentText(docx(xml), DOCX_MEDIA_TYPE)).toBe('Plan\t A & B\nShip');
    });

    it('reads a PPTX with slide10 after slide9', async () => {
        const zip = zipSync({
            'ppt/slides/slide10.xml': slide('ten'), 'ppt/slides/slide2.xml': slide('two'), 'ppt/slides/slide9.xml': slide('nine'),
            'ppt/slides/_rels/slide1.xml.rels': strToU8('<x/>'),
        });
        expect(await extractDocumentText(zip, PPTX_MEDIA_TYPE)).toBe('two\n\nnine\n\nten');
    });

    it('reads the XLSX shared strings, one line per string', async () => {
        const xml = '<sst><si><t>alpha</t></si><si><r><t>be</t></r><r><t xml:space="preserve">ta</t></r></si></sst>';
        expect(await extractDocumentText(zipSync({ 'xl/sharedStrings.xml': strToU8(xml) }), XLSX_MEDIA_TYPE)).toBe('alpha\nbeta');
    });

    it('reads an ODT with paragraphs, tabs and spaces', async () => {
        const xml = '<office:text><text:h>Title</text:h><text:p>a<text:tab/>b<text:s/>c<text:span>d</text:span></text:p><text:p>&lt;x&gt;</text:p></office:text>';
        expect(await extractDocumentText(zipSync({ 'content.xml': strToU8(xml) }), ODT_MEDIA_TYPE)).toBe('Title\na\tb cd\n<x>');
    });

    it('reads a tiny PDF', async () => {
        expect(await extractDocumentText(tinyPdf('Hello PDF'), PDF_MEDIA_TYPE)).toContain('Hello PDF');
    });

    it('never detaches the caller\'s buffer (pdf.js gets a private copy)', async () => {
        const bytes = tinyPdf('Hello PDF');
        const length = bytes.byteLength;
        await extractDocumentText(bytes, PDF_MEDIA_TYPE);
        expect(bytes.byteLength).toBe(length);
        // Read again from the same bytes: still readable.
        expect(await extractDocumentText(bytes, PDF_MEDIA_TYPE)).toContain('Hello PDF');
    });

    it('returns undefined for legacy types, malformed bytes and empty documents', async () => {
        expect(await extractDocumentText(docx('<w:p/>'), 'application/msword')).toBeUndefined();
        expect(await extractDocumentText(strToU8('not a zip'), DOCX_MEDIA_TYPE)).toBeUndefined();
        expect(await extractDocumentText(docx('<w:body></w:body>'), DOCX_MEDIA_TYPE)).toBeUndefined();
    });
});

describe('readDocument', () => {
    it('tells "opens, but has no text" from "unreadable"', async () => {
        expect(await readDocument(tinyPdf(''), PDF_MEDIA_TYPE)).toEqual({ failure: 'no-text' });
        expect(await readDocument(strToU8('%PDF-1.4 this is not a pdf'), PDF_MEDIA_TYPE)).toMatchObject({ failure: 'unreadable' });
        expect(await readDocument(docx('<w:body></w:body>'), DOCX_MEDIA_TYPE)).toEqual({ failure: 'no-text' });
        expect(await readDocument(zipSync({ 'xl/workbook.xml': strToU8('<x/>') }), DOCX_MEDIA_TYPE)).toMatchObject({ failure: 'unreadable' });
        expect(await readDocument(docx('<w:p/>'), 'application/msword')).toMatchObject({ failure: 'unreadable' });
    });

    it('a zip whose deflate data is corrupt is unreadable, not no-text', async () => {
        const zip = docx(`<w:p><w:r><w:t>${'corrupt me '.repeat(200)}</w:t></w:r></w:p>`);
        const nameLength = new DataView(zip.buffer).getUint16(26, true);
        const data = 30 + nameLength + new DataView(zip.buffer).getUint16(28, true);
        for (let i = data; i < data + 16; i++) zip[i] = 0xff;
        expect(await readDocument(zip, DOCX_MEDIA_TYPE)).toMatchObject({ failure: 'unreadable' });
    });
});

describe('zipEntryNames', () => {
    it('lists the entries without inflating, undefined for bytes that are not a zip', () => {
        expect(zipEntryNames(zipSync({ 'a.xml': strToU8('<a/>'), 'b/c.xml': strToU8('<c/>') }))).toEqual(['a.xml', 'b/c.xml']);
        expect(zipEntryNames(new Uint8Array([0x50, 0x4b, 1, 2, 3, 4, 5, 6]))).toBeUndefined();
    });
});

describe('decodeEntities', () => {
    it('decodes named and numeric entities, ampersand last', () => {
        expect(decodeEntities('&lt;a&gt; &quot;&apos; &#65;&#x42; &amp;lt;')).toBe('<a> "\' AB &lt;');
    });

    it('clamps invalid code points to U+FFFD instead of throwing', () => {
        expect(decodeEntities('a&#99999999;b')).toBe('a�b');
        expect(decodeEntities('&#xD800;&#x110000;')).toBe('��');
    });
});

describe('size caps', () => {
    it('rejects an entry declaring a huge size, without inflating it', async () => {
        const zip = declareSize(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'), 0x7fffffff);
        const started = Date.now();
        expect(await extractDocumentText(zip, DOCX_MEDIA_TYPE)).toBeUndefined();
        expect(Date.now() - started).toBeLessThan(500);
    });

    it('rejects an entry over the per-entry cap and a zip over the total cap', async () => {
        const nine = 9 * 1024 * 1024;
        expect(await extractDocumentText(declareSize(docx('<w:t>x</w:t>'), nine), DOCX_MEDIA_TYPE)).toBeUndefined();
        const slides: Record<string, Uint8Array> = {};
        for (let i = 1; i <= 3; i++) slides[`ppt/slides/slide${i}.xml`] = slide(`s${i}`);
        // Three slides each declaring 7 MB: each under the entry cap, 21 MB together (the DECLARED total is capped too).
        expect(await extractDocumentText(declareSize(zipSync(slides), 7 * 1024 * 1024), PPTX_MEDIA_TYPE)).toBeUndefined();
    });

    it('rejects a zip bomb whose headers lie about the size, without inflating it all', async () => {
        const zeros = new Uint8Array(64 * 1024 * 1024);
        // zipSync deflates the zeros (a few tens of KB); both headers are then patched to declare 10 bytes.
        const bomb = declareSize(zipSync({ 'word/document.xml': zeros }), 10);
        expect(bomb.length).toBeLessThan(1024 * 1024);
        let chunks = 0;
        let inflated = 0;
        expect(() => unzipEntries(bomb, (n) => n === 'word/document.xml', undefined, (c) => { chunks++; inflated += c.length; }))
            .toThrow('document');
        // Stopped at the cap: the 64 MB payload was never fully inflated.
        expect(chunks).toBeGreaterThan(0);
        expect(inflated).toBeLessThanOrEqual(16 * 1024 * 1024);
        expect(inflated).toBeLessThan(zeros.length);
        expect(await extractDocumentText(bomb, DOCX_MEDIA_TYPE)).toBeUndefined();
    });

    it('rejects a zip with too many entries', async () => {
        const files: Record<string, Uint8Array> = { 'word/document.xml': strToU8('<w:p><w:r><w:t>x</w:t></w:r></w:p>') };
        for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) files[`f${i}`] = new Uint8Array(0);
        expect(await extractDocumentText(zipSync(files), DOCX_MEDIA_TYPE)).toBeUndefined();
    });
});

describe('linear scanner', () => {
    /** Fastest of a few runs: the least load-sensitive estimate of the work itself. */
    async function fastest(bytes: Uint8Array): Promise<number> {
        let best = Number.POSITIVE_INFINITY;
        for (let run = 0; run < 5; run++) {
            const started = performance.now();
            await extractDocumentText(bytes, DOCX_MEDIA_TYPE);
            best = Math.min(best, performance.now() - started);
        }
        return best;
    }

    it('scales linearly on unclosed tags: doubling the input far less than quadruples the time', async () => {
        const size = 512 * 1024;
        for (const piece of ['<w:t>', '<w:t ', '<w:t><w:p>']) {
            const once = docx(piece.repeat(Math.ceil(size / piece.length)));
            const twice = docx(piece.repeat(Math.ceil((2 * size) / piece.length)));
            await fastest(twice); // warm-up: JIT and the lazily loaded pieces, outside the measurement
            const ratio = (await fastest(twice)) / Math.max(await fastest(once), 0.5);
            // Linear ≈ 2; quadratic ≈ 4. The 0.5 ms floor keeps a sub-millisecond run from inflating the ratio.
            expect(ratio).toBeLessThan(3);
        }
    });
});

describe('abort', () => {
    it('throws the abort reason from a pre-aborted signal', async () => {
        const controller = new AbortController();
        controller.abort(new Error('stopped'));
        await expect(extractDocumentText(docx('<w:t>x</w:t>'), DOCX_MEDIA_TYPE, controller.signal)).rejects.toThrow('stopped');
    });

    it('throws between zip entries when the signal flips mid-extraction', async () => {
        const slides: Record<string, Uint8Array> = {};
        for (let i = 1; i <= 5; i++) slides[`ppt/slides/slide${i}.xml`] = slide(`s${i}`);
        let checks = 0;
        const reason = new Error('mid-run stop');
        const signal = {
            get aborted() { return checks > 2; },
            throwIfAborted() { if (++checks > 2) throw reason; },
        } as unknown as AbortSignal;
        await expect(extractDocumentText(zipSync(slides), PPTX_MEDIA_TYPE, signal)).rejects.toBe(reason);
    });
});
