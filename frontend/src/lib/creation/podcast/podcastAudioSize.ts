/**
 * The size of a published master audio file, for the feed's enclosure `length`.
 *
 * A HEAD request for `Content-Length`. A host that does not answer cross-origin requests,
 * or does not expose that header to scripts, yields null — the editor then asks the
 * person to enter the size instead of emitting a feed a directory would reject.
 */
export async function measureRemoteBytes(url: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const response = await fetchImpl(url, { method: 'HEAD', mode: 'cors', credentials: 'omit' });
    if (!response.ok) return null;
    const length = Number(response.headers.get('content-length'));
    return Number.isFinite(length) && length > 0 ? Math.floor(length) : null;
  } catch {
    return null;
  }
}
