/**
 * The two drives behind one port.
 *
 * Three properties are load-bearing and none is obvious from the call site:
 *   1. A Google-native document has NO bytes — it must be exported, and the
 *      format asked for is the Office container the canvas can already read. Get
 *      this wrong and a Google Doc lands on the board as an opaque attachment.
 *   2. Both providers' very different listing shapes normalize to the same item,
 *      because the tree and the importer are written once.
 *   3. The size ceiling is enforced on the BODY, not just the header — a chunked
 *      response advertises no length, and "we checked the header" would let an
 *      unbounded download into a Worker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleDrive, microsoftDrive, getDriveProvider, availableDriveProviders, DriveProviderError, MAX_DRIVE_DOWNLOAD_BYTES } from './driveProviders';

const calls: string[] = [];

/** Record every request and answer it from a table keyed by URL fragment. */
function stubFetch(routes: Array<[RegExp, () => Response]>) {
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push(url);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`Unstubbed request: ${url}`);
    return route[1]();
  });
}

const json = (body: unknown) => () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** Read a recorded URL back as the query the provider meant. `URLSearchParams`
 * form-encodes spaces as `+`, which `decodeURIComponent` does not undo. */
const readQuery = (url: string) => decodeURIComponent(url.replace(/\+/g, ' '));

afterEach(() => { vi.unstubAllGlobals(); calls.length = 0; });

describe('googleDrive', () => {
  it('lists a folder, marking folders and carrying sizes through', async () => {
    stubFetch([[/drive\/v3\/files\?/, json({
      files: [
        { id: 'f1', name: 'Reports', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'd1', name: 'Q3.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: '2048', modifiedTime: '2026-08-01T00:00:00Z' },
      ],
      nextPageToken: 'page-2',
    })]]);

    const listing = await googleDrive.list('token', 'parent-1');
    expect(listing.items[0]).toMatchObject({ id: 'f1', kind: 'folder' });
    expect(listing.items[1]).toMatchObject({ id: 'd1', kind: 'file', sizeBytes: 2048, parentId: 'parent-1' });
    expect(listing.nextCursor).toBe('page-2');
  });

  it('lists the root when no folder is given', async () => {
    stubFetch([[/drive\/v3\/files\?/, json({ files: [] })]]);
    await googleDrive.list('token', null);
    expect(readQuery(calls[0]!)).toContain("'root' in parents");
  });

  it('escapes a folder id so it cannot break out of the query', async () => {
    stubFetch([[/drive\/v3\/files\?/, json({ files: [] })]]);
    await googleDrive.list('token', "x' or name != '");
    // The quote is escaped rather than closing the string and appending a clause.
    expect(readQuery(calls[0]!)).toContain("'x\\' or name != \\'' in parents");
  });

  it('EXPORTS a Google Doc as .docx so it lands as an editable document', async () => {
    stubFetch([
      [/files\/doc-1\?fields/, json({ id: 'doc-1', name: 'Strategy', mimeType: 'application/vnd.google-apps.document' })],
      [/\/export\?/, () => new Response(new ArrayBuffer(16), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } })],
    ]);

    const file = await googleDrive.download('token', 'doc-1');
    expect(file.fileName).toBe('Strategy.docx');
    expect(readQuery(calls[1]!)).toContain('mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('downloads a regular file as its own bytes', async () => {
    stubFetch([
      [/files\/pdf-1\?fields/, json({ id: 'pdf-1', name: 'Contract.pdf', mimeType: 'application/pdf' })],
      [/alt=media/, () => new Response(new ArrayBuffer(8), { headers: { 'content-type': 'application/pdf' } })],
    ]);
    const file = await googleDrive.download('token', 'pdf-1');
    expect(file).toMatchObject({ fileName: 'Contract.pdf', mimeType: 'application/pdf' });
  });

  it('refuses a Google file with no downloadable form rather than writing an empty one', async () => {
    stubFetch([[/files\/form-1\?fields/, json({ id: 'form-1', name: 'Survey', mimeType: 'application/vnd.google-apps.form' })]]);
    await expect(googleDrive.download('token', 'form-1')).rejects.toThrow(/no downloadable form/);
  });

  it('reports an expired grant as 401 so the caller can say "reconnect"', async () => {
    stubFetch([[/drive\/v3\/files\?/, () => new Response('nope', { status: 401 })]]);
    await expect(googleDrive.list('token', null)).rejects.toMatchObject({ status: 401 });
  });
});

describe('microsoftDrive', () => {
  it('normalizes Graph children to the same item shape', async () => {
    stubFetch([[/me\/drive\/root\/children/, json({
      value: [
        { id: 'F', name: 'Docs', folder: { childCount: 2 }, parentReference: { id: 'root' } },
        { id: 'X', name: 'Plan.xlsx', size: 99, file: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, lastModifiedDateTime: '2026-08-02T00:00:00Z' },
      ],
      '@odata.nextLink': 'https://graph.microsoft.com/next',
    })]]);

    const listing = await microsoftDrive.list('token', null);
    expect(listing.items[0]).toMatchObject({ id: 'F', kind: 'folder', mimeType: 'inode/directory' });
    expect(listing.items[1]).toMatchObject({ id: 'X', kind: 'file', sizeBytes: 99 });
    expect(listing.nextCursor).toBe('https://graph.microsoft.com/next');
  });

  it('follows Graph\'s own nextLink verbatim rather than rebuilding the query', async () => {
    stubFetch([[/graph\.microsoft\.com\/next-page/, json({ value: [] })]]);
    await microsoftDrive.list('token', null, 'https://graph.microsoft.com/next-page');
    expect(calls[0]).toBe('https://graph.microsoft.com/next-page');
  });

  it('refuses an oversized file before transferring it', async () => {
    stubFetch([[/items\/big\?\$select/, json({ id: 'big', name: 'huge.zip', size: MAX_DRIVE_DOWNLOAD_BYTES + 1 })]]);
    await expect(microsoftDrive.download('token', 'big')).rejects.toMatchObject({ status: 413 });
  });

  it('enforces the ceiling on the BODY too, for a response that declares no length', async () => {
    stubFetch([
      [/items\/chunked\?\$select/, json({ id: 'chunked', name: 'stream.bin' })],
      [/\/content/, () => new Response(new ArrayBuffer(MAX_DRIVE_DOWNLOAD_BYTES + 1))],
    ]);
    await expect(microsoftDrive.download('token', 'chunked')).rejects.toMatchObject({ status: 413 });
  });
});

describe('provider registry', () => {
  it('resolves by name and refuses anything else', () => {
    expect(getDriveProvider('google')).toBe(googleDrive);
    expect(getDriveProvider('microsoft')).toBe(microsoftDrive);
    expect(getDriveProvider('dropbox')).toBeNull();
  });

  it('reports a provider as unconfigured when the deployment has no client secret', () => {
    const available = availableDriveProviders({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });
    expect(available.find((p) => p.name === 'google')?.configured).toBe(true);
    expect(available.find((p) => p.name === 'microsoft')?.configured).toBe(false);
  });

  it('asks Google for offline access, or the grant would die within the hour', () => {
    expect(googleDrive.extraAuthParams?.access_type).toBe('offline');
    expect(microsoftDrive.scopes).toContain('offline_access');
  });

  it('requests read-only scopes only', () => {
    expect(googleDrive.scopes).toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(googleDrive.scopes.some((s) => s.endsWith('/auth/drive'))).toBe(false);
    expect(microsoftDrive.scopes).toContain('Files.Read');
    expect(microsoftDrive.scopes).not.toContain('Files.ReadWrite');
  });

  it('carries the status on a provider error so a caller can tell reconnect from retry', () => {
    expect(new DriveProviderError('x', 401).status).toBe(401);
  });
});
