import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequestStream: vi.fn(async () => ({ ok: true }) as unknown as Response),
  getVisitorId: vi.fn((): string | null => 'visitor-1'),
  getFirstTouch: vi.fn(() => ({ landingPath: '/', referrer: '', utm: {} })),
  createLocalCreationSession: vi.fn(() => 'local-1'),
}));

vi.mock('./apiClient', () => ({ apiRequestStream: mocks.apiRequestStream }));
vi.mock('./visitor', () => ({ getVisitorId: mocks.getVisitorId, getFirstTouch: mocks.getFirstTouch }));
vi.mock('./creationSessions', () => ({ createLocalCreationSession: mocks.createLocalCreationSession }));
vi.mock('./brain', () => ({ NEW_CHAT_MODE: 'work' }));

import { recordGuestPrompt, startGuestCreationSession } from './guestPromptCapture';

/** The JSON body the helper actually posted. */
function sentBody(): Record<string, unknown> {
  const [, init] = mocks.apiRequestStream.mock.calls.at(-1) as unknown as [string, RequestInit];
  return JSON.parse(String(init.body));
}

describe('recordGuestPrompt', () => {
  beforeEach(() => {
    mocks.apiRequestStream.mockClear();
    mocks.createLocalCreationSession.mockClear();
    mocks.getVisitorId.mockReturnValue('visitor-1');
    mocks.apiRequestStream.mockResolvedValue({ ok: true } as unknown as Response);
  });

  it('posts the prompt with its surface, session and first-touch attribution', async () => {
    await expect(recordGuestPrompt({
      prompt: '  Build me a CRM  ', surface: 'landing', sessionRef: 'local-1', mode: 'work',
    })).resolves.toBe(true);

    const [path] = mocks.apiRequestStream.mock.calls[0] as unknown as [string];
    expect(path).toBe('/api/guest/prompt');
    expect(sentBody()).toMatchObject({
      visitorId: 'visitor-1',
      prompt: 'Build me a CRM',
      surface: 'landing',
      sessionRef: 'local-1',
      mode: 'work',
    });
  });

  it('rides the navigation that follows it — the request must be keepalive', async () => {
    await recordGuestPrompt({ prompt: 'Build a CRM', surface: 'landing' });
    const [, init] = mocks.apiRequestStream.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.keepalive).toBe(true);
  });

  it('sends nothing when there is no visitor id or nothing was typed', async () => {
    await expect(recordGuestPrompt({ prompt: '   ', surface: 'landing' })).resolves.toBe(false);
    mocks.getVisitorId.mockReturnValue(null);
    await expect(recordGuestPrompt({ prompt: 'Build a CRM', surface: 'landing' })).resolves.toBe(false);
    expect(mocks.apiRequestStream).not.toHaveBeenCalled();
  });

  it('never throws — a marketing capture must not break the surface that fired it', async () => {
    mocks.apiRequestStream.mockRejectedValueOnce(new Error('offline'));
    await expect(recordGuestPrompt({ prompt: 'Build a CRM', surface: 'landing' })).resolves.toBe(false);
  });
});

describe('startGuestCreationSession', () => {
  beforeEach(() => {
    mocks.apiRequestStream.mockClear();
    mocks.createLocalCreationSession.mockClear();
    mocks.getVisitorId.mockReturnValue('visitor-1');
    mocks.apiRequestStream.mockResolvedValue({ ok: true } as unknown as Response);
  });

  it('creates the local draft AND records the intent against it', () => {
    expect(startGuestCreationSession('Build me a CRM', { mode: 'chat', surface: 'landing' })).toBe('local-1');
    expect(mocks.createLocalCreationSession).toHaveBeenCalledWith('Build me a CRM', 'chat');
    expect(sentBody()).toMatchObject({ prompt: 'Build me a CRM', sessionRef: 'local-1', surface: 'landing' });
  });

  it('defaults the mode so a caller that has no composer still records one', () => {
    startGuestCreationSession('Build me a CRM');
    expect(mocks.createLocalCreationSession).toHaveBeenCalledWith('Build me a CRM', 'work');
  });

  it('still opens the session when there is nothing to record', () => {
    expect(startGuestCreationSession('')).toBe('local-1');
    expect(mocks.apiRequestStream).not.toHaveBeenCalled();
  });

  it('returns the session id synchronously — the capture never delays the navigation', () => {
    // A pending request must not stop the caller getting an id to route to.
    mocks.apiRequestStream.mockReturnValue(new Promise(() => {}) as unknown as Promise<Response>);
    expect(startGuestCreationSession('Build me a CRM')).toBe('local-1');
  });
});
