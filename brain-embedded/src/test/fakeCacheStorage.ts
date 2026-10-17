/**
 * An in-memory Cache Storage for tests — just the calls the model store makes. `put`
 * drains the body the way the real one does, so a stream that errors (a cancelled
 * download) leaves no entry behind.
 */

interface Stored {
  bytes: ArrayBuffer;
  headers: Headers;
}

class FakeCache {
  readonly entries = new Map<string, Stored>();

  async match(url: string): Promise<Response | undefined> {
    const hit = this.entries.get(url);
    return hit ? new Response(hit.bytes.slice(0), { headers: hit.headers }) : undefined;
  }

  async put(url: string, response: Response): Promise<void> {
    const bytes = await response.arrayBuffer();
    this.entries.set(url, { bytes, headers: new Headers(response.headers) });
  }

  async delete(url: string): Promise<boolean> {
    return this.entries.delete(url);
  }
}

export class FakeCacheStorage {
  readonly buckets = new Map<string, FakeCache>();

  async has(name: string): Promise<boolean> {
    return this.buckets.has(name);
  }

  async open(name: string): Promise<FakeCache> {
    let bucket = this.buckets.get(name);
    if (!bucket) {
      bucket = new FakeCache();
      this.buckets.set(name, bucket);
    }
    return bucket;
  }

  /** As the code under test sees it. */
  asCacheStorage(): CacheStorage {
    return this as unknown as CacheStorage;
  }
}
