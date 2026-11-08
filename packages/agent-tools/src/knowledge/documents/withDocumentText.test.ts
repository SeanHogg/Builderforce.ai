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

async function listAll(source: DirectorySource): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for await (const e of source.list()) out.set(e.path, e.hash);
    return out;
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

    it('maps the extracted text back to the hash of the bytes actually read', async () => {
        const base = { ...memorySource(files), hashOf: (text: string) => sha256Hex(text) };
        const wrapped = withDocumentText(base, readBytes, sha256Hex);
        const listed = await listAll(wrapped);
        const text = ((await wrapped.read('plan.docx')).content as { text: string }).text;
        expect(wrapped.hashOf!(text, 'plan.docx')).toBe(listed.get('plan.docx'));
    });

    it('reports a changed file as changed: the hash follows the bytes of the latest read, not the listing', async () => {
        const live = { 'plan.docx': tinyDocx() };
        const base = { ...memorySource(live), hashOf: (text: string) => sha256Hex(text) };
        const wrapped = withDocumentText(base, async (p) => live[p as 'plan.docx'], sha256Hex);
        const listed = (await listAll(wrapped)).get('plan.docx');
        live['plan.docx'] = zipSync({ 'word/document.xml': strToU8('<w:p><w:r><w:t>Edited</w:t></w:r></w:p>') });
        const text = ((await wrapped.read('plan.docx')).content as { text: string }).text;
        expect(wrapped.hashOf!(text, 'plan.docx')).not.toBe(listed);
    });

    it('keeps two identical-text documents at different paths on their own hashes', async () => {
        const same = '<w:p><w:r><w:t>Same words</w:t></w:r></w:p>';
        const two = {
            'a.docx': zipSync({ 'word/document.xml': strToU8(same), 'a.bin': strToU8('a') }),
            'b.docx': zipSync({ 'word/document.xml': strToU8(same), 'b.bin': strToU8('b') }),
        };
        const base = { ...memorySource(two), hashOf: (text: string) => sha256Hex(text) };
        const wrapped = withDocumentText(base, async (p) => two[p as keyof typeof two], sha256Hex);
        const listed = await listAll(wrapped);
        const a = ((await wrapped.read('a.docx')).content as { text: string }).text;
        const b = ((await wrapped.read('b.docx')).content as { text: string }).text;
        expect(a).toBe(b);
        expect(wrapped.hashOf!(a, 'a.docx')).toBe(listed.get('a.docx'));
        expect(wrapped.hashOf!(b, 'b.docx')).toBe(listed.get('b.docx'));
        expect(listed.get('a.docx')).not.toBe(listed.get('b.docx'));
    });

    it('delegates hashOf to the inner source for other paths and when no byte hash is given', async () => {
        const base = { ...memorySource(files), hashOf: (text: string, path?: string) => `inner:${path}:${text.length}` };
        const withBytes = withDocumentText(base, readBytes, sha256Hex);
        expect(withBytes.hashOf!('hello', 'notes.md')).toBe('inner:notes.md:5');
        const without = withDocumentText(base, readBytes);
        await without.read('plan.docx');
        expect(without.hashOf!('hello', 'plan.docx')).toBe('inner:plan.docx:5');
    });

    it('gives document paths a 60 s read deadline and delegates the rest', () => {
        const wrapped = withDocumentText({ ...memorySource(files), readTimeoutMs: () => 1234 }, readBytes);
        expect(wrapped.readTimeoutMs!('plan.pdf')).toBe(60_000);
        expect(wrapped.readTimeoutMs!('notes.md')).toBe(1234);
        expect(withDocumentText(memorySource(files), readBytes).readTimeoutMs!('notes.md')).toBeUndefined();
    });
});
