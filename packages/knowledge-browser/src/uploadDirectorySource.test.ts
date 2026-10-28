import { describe, expect, it } from 'vitest';
import { createUploadDirectorySource } from './uploadDirectorySource';
import { contentHash, metadataHash } from './directorySourceKit';

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

  it('reads a file as a text document', async () => {
    const doc = await createUploadDirectorySource(files, 'web').read('policy/a.md');
    expect(doc.content).toMatchObject({ kind: 'text', text: 'policy' });
  });
});
