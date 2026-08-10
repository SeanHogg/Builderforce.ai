import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendVerificationCodeEmail } from './EmailService';

afterEach(() => vi.unstubAllGlobals());

describe('email provider fallback', () => {
  it.each(['daily_quota_exceeded', 'monthly_quota_exceeded'])(
    'falls back to SendPulse when Resend reports %s',
    async (quotaCode) => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ name: quotaCode, message: 'quota reached' }), { status: 429 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ result: true, id: 'sp-1' }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      await sendVerificationCodeEmail(
        { RESEND_API_KEY: 're_test', SENDPULSE_API_KEY: 'sp_test' },
        'user@example.com',
        'Ada',
        '123456',
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]![0]).toBe('https://api.resend.com/emails');
      expect(fetchMock.mock.calls[1]![0]).toBe('https://api.sendpulse.com/smtp/emails');
      const sendPulseRequest = fetchMock.mock.calls[1]![1] as RequestInit;
      expect((sendPulseRequest.headers as Record<string, string>).Authorization).toBe('Bearer sp_test');
      const payload = JSON.parse(sendPulseRequest.body as string) as {
        email: { html: string; to: Array<{ email: string }> };
      };
      expect(payload.email.to).toEqual([{ email: 'user@example.com' }]);
      expect(payload.email.html).toBeTruthy();
    },
  );

  it('does not mask a non-quota Resend rejection', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'validation_error', message: 'domain is not verified' }), { status: 403 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendVerificationCodeEmail(
      { RESEND_API_KEY: 're_test', SENDPULSE_API_KEY: 'sp_test' },
      'user@example.com',
      'Ada',
      '123456',
    )).rejects.toMatchObject({ provider: 'resend', code: 'validation_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses SendPulse when it is the only configured provider', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ result: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendVerificationCodeEmail(
      { SENDPULSE_API_KEY: 'sp_test' },
      'user@example.com',
      'Ada',
      '123456',
    );

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.sendpulse.com/smtp/emails');
  });
});
