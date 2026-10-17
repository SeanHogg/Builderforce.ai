import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_URL, LOOPBACK_ORIGINS, PLATFORM_ORIGINS } from './config';

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'manifest.json'), 'utf8'),
) as {
  host_permissions: string[];
  optional_host_permissions: string[];
  permissions: string[];
  content_scripts?: unknown;
  content_security_policy?: { extension_pages?: string };
};

describe('Rovr config ↔ manifest', () => {
  it('may reach the platform and this machine without asking — and nothing else', () => {
    const expected = [...PLATFORM_ORIGINS, ...LOOPBACK_ORIGINS].map((o) => `${o}/*`).sort();
    expect([...manifest.host_permissions].sort()).toEqual(expected);
    expect(manifest.host_permissions.some((p) => new URL(DEFAULT_BASE_URL).origin === p.replace(/\/\*$/, ''))).toBe(true);
  });

  it('reaches web sites only through optional, per-site grants — never a blanket content script', () => {
    expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.permissions).toEqual(expect.arrayContaining(['sidePanel', 'storage', 'tabs', 'activeTab', 'scripting']));
  });

  it('lets the panel compile WebAssembly for its on-device engines, and nothing looser', () => {
    // WebLLM and the WebGPU `bfi` instantiate wasm in the side panel. Their model
    // downloads (huggingface.co and its *.hf.co CDN, WebLLM's libs on
    // raw.githubusercontent.com) are plain CORS fetches — every one of those origins
    // answers `Access-Control-Allow-Origin` — so they need no host permission.
    expect(manifest.content_security_policy?.extension_pages).toBe("script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
  });
});
