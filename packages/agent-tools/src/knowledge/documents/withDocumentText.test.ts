import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { DOCS_PACK, planDetail, sha256Hex, type DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import { knowledgePacks } from '../knowledgePacks.js';
import { withDocumentText } from './withDocumentText.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A minimal DOCX: a zip whose `word/document.xml` holds two paragraphs. */
function tinyDocx(): Uint8Array {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Quarterly plan</w:t></w:r></w:p><w:p><w:r><w:t>Ship the importer.</w:t></w:r></w:p></w:body></w:document>';
    return zipSync({ 'word/document.xml': strToU8(xml) });
}

/** An in-memory source whose `read` is the raw (garbage) UTF-8 decode, as a plain host's would be. */
function memorySource(files: Record<string, Uint8Array>): DirectorySource {
    return {
        rootId: 'test:docs',
        title: 'docs',
        async *list() {
            for (const [path, bytes] of Object.entries(files)) yield { path, hash: sha256Hex(bytes), size: bytes.byteLength };
        },
        async read(path) {
            const text = new TextDecoder('utf-8').decode(files[path]);
            return { id: path, tenantId: 'test:docs', title: path, content: { kind: 'text', text } };
        },
    };
}

describe('withDocumentText', () => {
    const files = { 'plan.docx': tinyDocx(), 'notes.md': strToU8('# Notes\n\nhello') };
    const readBytes = async (path: string) => files[path as keyof typeof files]!;

    it('reads a docx as the text of its content, under its original media type', async () => {
        const doc = await withDocumentText(memorySource(files), readBytes).read('plan.docx');
        expect(doc.content).toMatchObject({ kind: 'text', mediaType: DOCX });
        expect((doc.content as { text: string }).text).toBe('Quarterly plan\nShip the importer.');
    });

    it('passes a non-document through unchanged', async () => {
        const doc = await withDocumentText(memorySource(files), readBytes).read('notes.md');
        expect((doc.content as { text: string }).text).toBe('# Notes\n\nhello');
    });

    it('plans the docx as a document, not an asset', async () => {
        const wrapped = withDocumentText(memorySource(files), readBytes);
        const withoutPack = await planDetail(wrapped, new InMemoryIngestManifest(), [DOCS_PACK]);
        const withPack = await planDetail(wrapped, new InMemoryIngestManifest(), knowledgePacks());
        // Control: without the documents pack the same file is an asset; with it, it is planned for extraction.
        expect(withoutPack.plan.assets).toBe(1);
        expect(withPack.plan.assets).toBe(0);
        expect(withPack.files.find((f) => f.path === 'plan.docx')).toMatchObject({ pack: expect.any(String) });
        expect(withPack.files.find((f) => f.path === 'plan.docx')?.asset).toBeUndefined();
    });

    it('keeps the listing hash over the bytes and maps the extracted text back to it', async () => {
        const base = { ...memorySource(files), hashOf: (text: string) => sha256Hex(text) };
        const wrapped = withDocumentText(base, readBytes);
        const listed = (await (async () => { const out = []; for await (const e of wrapped.list()) out.push(e); return out; })()).find((e) => e.path === 'plan.docx')!;
        const text = ((await wrapped.read('plan.docx')).content as { text: string }).text;
        expect(wrapped.hashOf!(text)).toBe(listed.hash);
    });
});
