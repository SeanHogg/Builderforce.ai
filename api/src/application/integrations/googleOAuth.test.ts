import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchGoogleDrive, readGoogleDriveFileText, type GoogleOAuthCreds } from './googleOAuth';

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

const CREDS: GoogleOAuthCreds = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' };

/** Stubs the token exchange (always the first call) then answers subsequent
 *  calls with `rest`, in order. */
function stubFetch(rest: Array<() => Response>) {
  let call = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    if (call === 0) {
      call++;
      return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const next = rest[call - 1];
    call++;
    return next!();
  }) as unknown as typeof fetch;
  return calls;
}

describe('searchGoogleDrive', () => {
  it('sends a fullText query and returns the file list', async () => {
    const calls = stubFetch([
      () => new Response(JSON.stringify({ files: [{ id: 'f1', name: 'Report.docx', mimeType: 'application/vnd.google-apps.document' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    ]);

    const hits = await searchGoogleDrive(CREDS, "roadmap's Q3", 5);
    expect(hits).toEqual([{ id: 'f1', name: 'Report.docx', mimeType: 'application/vnd.google-apps.document' }]);

    const searchUrl = new URL(calls[1]!.url);
    expect(searchUrl.origin + searchUrl.pathname).toBe('https://www.googleapis.com/drive/v3/files');
    // The single-quote in the query is escaped per Drive's query grammar.
    expect(searchUrl.searchParams.get('q')).toBe("fullText contains 'roadmap\\'s Q3' and trashed = false");
    expect((calls[1]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('throws with the upstream error message on failure', async () => {
    stubFetch([() => new Response(JSON.stringify({ error: { message: 'insufficient scope' } }), { status: 403 })]);
    await expect(searchGoogleDrive(CREDS, 'x')).rejects.toThrow('insufficient scope');
  });
});

describe('readGoogleDriveFileText', () => {
  it('exports a Google Doc to plain text rather than fetching raw bytes', async () => {
    const calls = stubFetch([
      () => new Response(JSON.stringify({ id: 'f1', name: 'Notes', mimeType: 'application/vnd.google-apps.document' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
      () => new Response('plain text body', { status: 200 }),
    ]);

    const file = await readGoogleDriveFileText(CREDS, 'f1');
    expect(file).toEqual({ name: 'Notes', mimeType: 'text/plain', text: 'plain text body' });

    const exportUrl = new URL(calls[2]!.url);
    expect(exportUrl.pathname).toBe('/drive/v3/files/f1/export');
    expect(exportUrl.searchParams.get('mimeType')).toBe('text/plain');
  });

  it('fetches raw media (no export) for a non-Google-native file', async () => {
    const calls = stubFetch([
      () => new Response(JSON.stringify({ id: 'f2', name: 'data.csv', mimeType: 'text/csv' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
      () => new Response('a,b\n1,2', { status: 200 }),
    ]);

    const file = await readGoogleDriveFileText(CREDS, 'f2');
    expect(file).toEqual({ name: 'data.csv', mimeType: 'text/csv', text: 'a,b\n1,2' });
    expect(calls[2]!.url).toContain('/drive/v3/files/f2?');
    expect(calls[2]!.url).toContain('alt=media');
  });

  it('throws when the file metadata lookup fails', async () => {
    stubFetch([() => new Response(JSON.stringify({ error: { message: 'File not found' } }), { status: 404 })]);
    await expect(readGoogleDriveFileText(CREDS, 'missing')).rejects.toThrow('File not found');
  });
});
