/**
 * Mock implementations for the Node standard library (fs, path, etc.) used by the tests.
 * These are placeholders that mirror expected APIs so the test suite is reachable.
 */

/**
 * Minimal process mock.
 */
export const process = {
  arch: process.arch,
  env: process.env,
  versions: process.versions,
  platform: process.platform,
};

/**
 * In-memory storage for test results (optional, used by later test improvements).
 */
export const mockSessionStorage = {
  __data: new Map<string, string>(),
  getItem: (key: string): string | null => mockSessionStorage.__data.get(key) ?? null,
  setItem: (key: string, value: string): void => mockSessionStorage.__data.set(key, value),
  removeItem: (key: string): void => mockSessionStorage.__data.delete(key),
  clear: (): void => mockSessionStorage.__data.clear(),
};

/**
 * Mock URL constructor support for file: URLs.
 * Not fully RFC-compliant but sufficient for test harnessed test-data handling.
 */
export class MockURL implements URL {
  constructor(url?: string | URL | Record<string, string> | undefined) {
    if (url === undefined) {
      this._url = new URL('file:///__tests__/mocks/modules');
    } else if (typeof url === 'string') {
      this._url = new URL(url.startsWith('file:') ? url : 'file://' + url);
    } else if (url instanceof URL) {
      this._url = url;
    } else {
      const base = 'file:///__tests__/mocks/modules';
      this._url = new URL('file://' + encodeURIComponent(JSON.stringify(url)), base);
    }
  }
  get href(): string { return this._url.href; }
  set href(v: string) { this._url.href = v; }
  get pathname(): string { return this._url.pathname; }
  set pathname(v: string) { this._url.pathname = v; }
  get protocol(): string { return this._url.protocol; }
  get origin(): string { return this._url.origin; }
  get search(): string { return this._url.search; }
  searchParams: URLSearchParams = new URLSearchParams(); // placeholder
  get hash(): string { return this._url.hash; }
  set hash(v: string) { this._url.hash = v; }
  toJSON(): string { return this._url.toJSON(); }
  toString(): string { return this._url.toString(); }

  // TODO: mock other URL API methods as they surface in tests.
}