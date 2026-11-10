import { describe, expect, it } from 'vitest';
import { createUploadDirectorySource } from './uploadDirectorySource';
import { bytesHash, textContentHash as contentHash, metadataHash, withDocumentText } from './directorySourceKit';
import { docxBytes } from './docx.test-util';

/** The slice of an `<input webkitdirectory>` File the adapter reads. */
const file = (webkitRelativePath: string, text: string, lastModified = 1): File =>
  ({ webkitRelativePath, name: webkitRelativePath.split('/').pop()!, size: text.length, lastModified, text: async () => text }) as unknown as File;

describe('folder upload directory source', () => {
  const files = [
    file('contracts/lease.md', 'lease'),
    file('contracts/node_modules/x/index.js', 'skip'),
    file('contracts/policy/a.md', 'policy'),
    file('contracts/logo.png', 'png-bytes', 9),
  ];

  it("hands out a file's raw bytes; read() stays the plain text read (extraction is the review worker's)", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const pdf = { ...file('d/a.pdf', 'x'), arrayBuffer: async () => bytes.buffer } as unknown as File;
    const source = createUploadDirectorySource([pdf], 'web');
    expect(await source.readBytes('a.pdf')).toEqual(bytes);
    expect(await source.readBytes('missing.pdf')).toEqual(new Uint8Array());
    expect((await source.read('a.pdf')).content).toMatchObject({ kind: 'text', text: 'x' });
  });

  it('roots at the uploaded folder under the host prefix', () => {
    expect(createUploadDirectorySource(files, 'web').rootId).toBe('web:upload:contracts');
    expect(createUploadDirectorySource(files, 'rovr').rootId).toBe('rovr:upload:contracts');
    expect(createUploadDirectorySource(files, 'web').title).toBe('contracts');
  });

  it('lists sorted, root-relative, skipping installs; text by content, binary by metadata', async () => {
    const out: Array<{ path: string; hash: string; size: number }> = [];
    for await (const e of createUploadDirectorySource(files, 'web').list()) out.push(e);
    expect(out).toEqual([
      { path: 'lease.md', hash: contentHash('lease'), size: 5 },
      { path: 'logo.png', hash: metadataHash('logo.png', 9, 9), size: 9 },
      { path: 'policy/a.md', hash: contentHash('policy'), size: 6 },
    ]);
  });

  it('hashOf of the text read() returns equals the hash list() gave (CRLF, non-ASCII)', async () => {
    const source = createUploadDirectorySource([
      file('d/crlf.md', 'one\r\ntwo\r\n'),
      file('d/uni.md', 'héllo — 日本語 😀'),
    ], 'web');
    for await (const entry of source.list()) {
      const doc = await source.read(entry.path);
      const text = (doc.content as { text: string }).text;
      expect(source.hashOf!(text, entry.path)).toBe(entry.hash);
    }
  });

  it('reads a file as a text document', async () => {
    const doc = await createUploadDirectorySource(files, 'web').read('policy/a.md');
    expect(doc.content).toMatchObject({ kind: 'text', text: 'policy' });
  });

  describe('a .docx and the changed-since-plan check', () => {
    const docx = (bytes: Uint8Array): File =>
      ({ webkitRelativePath: 'd/plan.docx', name: 'plan.docx', size: bytes.length, lastModified: 1, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) as unknown as File;
    const planHash = async (source: ReturnType<typeof createUploadDirectorySource>): Promise<string> => {
      for await (const entry of source.list()) return entry.hash;
      throw new Error('nothing listed');
    };

    it('lists a document by the hash of its bytes', async () => {
      const bytes = docxBytes('Hello');
      expect(await planHash(createUploadDirectorySource([docx(bytes)], 'web'))).toBe(bytesHash(bytes));
    });

    it('passes when the bytes read are the bytes planned, and fails when they changed after the plan', async () => {
      const planned = docxBytes('Hello from the plan');
      const hash = await planHash(createUploadDirectorySource([docx(planned)], 'web'));

      const review = async (readNow: Uint8Array): Promise<boolean> => {
        const source = createUploadDirectorySource([docx(readNow)], 'web');
        const wrapped = withDocumentText(source, (path, signal) => source.readBytes(path, signal), bytesHash);
        const doc = await wrapped.read('plan.docx');
        const text = (doc.content as { text: string }).text;
        expect(text).toContain('Hello');
        return wrapped.hashOf!(text, 'plan.docx') === hash; // the review's changed-since-plan comparison
      };

      expect(await review(planned)).toBe(true);
      expect(await review(docxBytes('Hello from an edited file'))).toBe(false);
    });

    it('without the byte hash the extracted text never matches the listing hash (the bug this guards)', async () => {
      const bytes = docxBytes('Hello');
      const source = createUploadDirectorySource([docx(bytes)], 'web');
      const hash = await planHash(source);
      const wrapped = withDocumentText(source, (path, signal) => source.readBytes(path, signal));
      const text = ((await wrapped.read('plan.docx')).content as { text: string }).text;
      expect(wrapped.hashOf!(text, 'plan.docx')).not.toBe(hash);
    });
  });
});
