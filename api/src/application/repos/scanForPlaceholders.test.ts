import { afterEach, describe, expect, it, vi } from 'vitest';
import * as repo from './readRepoContents';
import { detectPlaceholderMarkers, isScannablePath, scanWrittenForPlaceholders } from './scanForPlaceholders';

const ctx: repo.RepoReadContext = {
  provider: 'github', host: null, owner: 'a', repo: 'b', token: 't', ref: 'builderforce/task-58',
};

afterEach(() => vi.restoreAllMocks());

describe('detectPlaceholderMarkers', () => {
  // The actual stubs the weak model shipped in exec #53.
  it('flags the real exec-#53 stub asides', () => {
    expect(detectPlaceholderMarkers('// Placeholder for logging utility functions')).toContain('placeholder stub comment');
    expect(detectPlaceholderMarkers('// In a real implementation, this would interact with an email service provider'))
      .toContain('"in a real …" stub aside');
    expect(detectPlaceholderMarkers('// In a real system, this would write to a persistent log store'))
      .toContain('"in a real …" stub aside');
    expect(detectPlaceholderMarkers('// Assuming TaskState and TaskStatus are imported from "./types.js"'))
      .toContain('"assuming … exists/defined" hand-wave');
    expect(detectPlaceholderMarkers('// In production, this would save this to a database'))
      .toContain('"in production this would" stub');
    expect(detectPlaceholderMarkers('const PLATFORM_NAME = "BuilderForce"; // To be replaced with actual platform name'))
      .toContain('"replace with actual" token');
    expect(detectPlaceholderMarkers('// For this simulation, we assume it always succeeds.'))
      .toContain('simulated I/O stub');
    expect(detectPlaceholderMarkers('// Placeholder: Return a mock email based on accountId for testing.'))
      .toContain('mock value stub');
    expect(detectPlaceholderMarkers('Log in to [Platform Name] to view details'))
      .toContain('bracketed placeholder token');
  });

  it('does not flag ordinary finished code (no false positives)', () => {
    expect(detectPlaceholderMarkers('export async function sendEmail(to: string) { await resend.emails.send({ to }); }')).toEqual([]);
    // DOM placeholder attribute must not trip the placeholder rule.
    expect(detectPlaceholderMarkers('<input placeholder="Enter your email" />')).toEqual([]);
    expect(detectPlaceholderMarkers('const realtimeClient = new Client(); // connects on boot')).toEqual([]);
    expect(detectPlaceholderMarkers('// Retrieves the primary email for an account from the accounts service')).toEqual([]);
  });
});

describe('isScannablePath', () => {
  it('skips config, prose, and test/mock files', () => {
    expect(isScannablePath('src/services/notificationService.ts')).toBe(true);
    expect(isScannablePath('PRD.md')).toBe(false);
    expect(isScannablePath('package.json')).toBe(false);
    expect(isScannablePath('.github/workflows/ci.yml')).toBe(false);
    expect(isScannablePath('src/foo.test.ts')).toBe(false);
    expect(isScannablePath('src/foo.spec.tsx')).toBe(false);
    expect(isScannablePath('src/__mocks__/email.ts')).toBe(false);
  });
});

describe('scanWrittenForPlaceholders', () => {
  it('flags stub files, passes clean ones, skips config/test/unreadable', async () => {
    const files: Record<string, repo.ReadFileResult> = {
      'src/utils/email.ts': { ok: true, path: 'src/utils/email.ts', content: '// Placeholder for email\n// In a real implementation, this would call Resend', truncated: false },
      'src/real.ts': { ok: true, path: 'src/real.ts', content: 'export const x = await resend.emails.send(opts);', truncated: false },
      'src/utils/email.test.ts': { ok: true, path: 'src/utils/email.test.ts', content: '// mock email for the test', truncated: false },
      'config.json': { ok: true, path: 'config.json', content: '{"x":1}', truncated: false },
      'big.ts': { ok: true, path: 'big.ts', content: '// In a real system', truncated: true }, // truncated → skip
      'gone.ts': { ok: false, reason: 'not found' },                                            // unreadable → skip
    };
    vi.spyOn(repo, 'readRepoFile').mockImplementation(async (_c, path) => files[path] ?? { ok: false, reason: 'nope' });

    const r = await scanWrittenForPlaceholders(ctx, Object.keys(files));

    expect(r.flagged.map((f) => f.path)).toEqual(['src/utils/email.ts']);
    expect(r.clean).toEqual(['src/real.ts']);
    expect(r.skipped).toEqual(expect.arrayContaining(['src/utils/email.test.ts', 'config.json', 'big.ts', 'gone.ts']));
  });

  it('returns no flags when every file is clean (does not block a real finish)', async () => {
    vi.spyOn(repo, 'readRepoFile').mockResolvedValue({ ok: true, path: 'x.ts', content: 'export const ok = true;', truncated: false });
    const r = await scanWrittenForPlaceholders(ctx, ['x.ts']);
    expect(r.flagged).toEqual([]);
  });
});
