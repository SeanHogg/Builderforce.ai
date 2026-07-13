import { describe, it, expect } from 'vitest';
import { isTrustedHostOrigin, isVsCodeWebviewOrigin } from './embedTrust';

describe('isTrustedHostOrigin (embed trust boundary) [1462]', () => {
  const allow = ['https://app.burnrateos.com', 'https://staging.burnrateos.com'];

  it('accepts an origin on the allowlist', () => {
    expect(isTrustedHostOrigin('https://app.burnrateos.com', allow, true)).toBe(true);
  });

  it('rejects an origin not on the allowlist (prod or dev)', () => {
    expect(isTrustedHostOrigin('https://evil.example.com', allow, true)).toBe(false);
    expect(isTrustedHostOrigin('https://evil.example.com', allow, false)).toBe(false);
  });

  it('with no allowlist, rejects all origins in production (default-closed)', () => {
    expect(isTrustedHostOrigin('https://anything.com', [], true)).toBe(false);
  });

  it('with no allowlist, accepts in dev (convenience)', () => {
    expect(isTrustedHostOrigin('https://localhost:3001', [], false)).toBe(true);
  });
});

describe('isVsCodeWebviewOrigin (first-party VS Code bypass gate)', () => {
  it('accepts a vscode-webview origin (random per-webview guid)', () => {
    expect(isVsCodeWebviewOrigin('vscode-webview://0a1b2c3d-4e5f-6789-abcd-ef0123456789')).toBe(true);
  });

  it('rejects a third-party host origin (still subject to the integration gate)', () => {
    expect(isVsCodeWebviewOrigin('https://app.burnrateos.com')).toBe(false);
    expect(isVsCodeWebviewOrigin('https://builderforce.ai')).toBe(false);
  });

  it('rejects a lookalike that merely contains the scheme', () => {
    expect(isVsCodeWebviewOrigin('https://evil.com/vscode-webview://x')).toBe(false);
  });
});
