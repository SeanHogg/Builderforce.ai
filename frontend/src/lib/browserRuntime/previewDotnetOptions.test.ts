import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOTNET_BUNDLE_PATH, previewDotnetOptions } from './previewDotnetOptions';

const RELAY = 'https://preview.builderforce.ai/__bfwc/relay.html';

describe('the preview runtime’s .NET bundle URL', () => {
  it('points at /dotnet/<installed version>/ on the relay’s own origin (same origin as the process Workers)', () => {
    expect(previewDotnetOptions(RELAY, '2026.11.5')).toEqual({ bundleUrl: 'https://preview.builderforce.ai/dotnet/2026.11.5/' });
    expect(previewDotnetOptions('https://0123abcd-preview.builderforce.ai/__bfwc/relay.html', '2026.11.5-rc.1'))
      .toEqual({ bundleUrl: 'https://0123abcd-preview.builderforce.ai/dotnet/2026.11.5-rc.1/' });
  });

  it('passes no bundleUrl without an exact stamped version, so dotnet declines with its own reason', () => {
    for (const version of ['—', '', '^2026.11.5', 'latest', '2026.11']) {
      expect(previewDotnetOptions(RELAY, version), version).toEqual({});
    }
  });

  it('uses the version next.config.js stamps by default', () => {
    const stamped = process.env.NEXT_PUBLIC_RUNTIME_VERSION;
    const options = previewDotnetOptions(RELAY);
    if (stamped && /^\d+\.\d+\.\d+/.test(stamped)) expect(options.bundleUrl).toBe(`https://preview.builderforce.ai/dotnet/${stamped}/`);
    else expect(options).toEqual({});
  });

  it('names the same path the API serves the bundle on', () => {
    // Vitest runs from the frontend package root.
    const route = readFileSync(resolve(process.cwd(), '../api/src/presentation/middleware/dotnetBundleRoute.ts'), 'utf8');
    expect(route).toContain(`DOTNET_BUNDLE_PATH_PREFIX = '${DOTNET_BUNDLE_PATH}'`);
  });
});
