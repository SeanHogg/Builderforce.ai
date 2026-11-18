// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { askPreviewFrame } from '@/lib/previewProbe/previewFrameRequest';
import { CAPTURE_UNSUPPORTED, captureResultFrom, MAX_CAPTURE_CHARS } from './capturePreview';
import { PREVIEW_CAPTURE_RESULT, PREVIEW_CAPTURE_UNSUPPORTED } from './captureScript';

const reply = (id: string, result: Record<string, unknown>) => ({ type: PREVIEW_CAPTURE_RESULT, id, result });

describe('captureResultFrom', () => {
  it('accepts a JPEG or PNG data URL for its own request only', () => {
    expect(captureResultFrom(reply('a', { imageDataUrl: 'data:image/png;base64,AAAA', width: 2, height: 3 }), 'a'))
      .toEqual({ ok: true, value: { imageDataUrl: 'data:image/png;base64,AAAA', width: 2, height: 3, url: '' } });
    expect(captureResultFrom(reply('a', { imageDataUrl: 'data:image/png;base64,AAAA' }), 'b')).toBeUndefined();
  });

  it('refuses SVG, oversize and malformed images', () => {
    expect(captureResultFrom(reply('a', { imageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }), 'a')).toMatchObject({ ok: false });
    expect(captureResultFrom(reply('a', { imageDataUrl: `data:image/jpeg;base64,${'A'.repeat(MAX_CAPTURE_CHARS)}` }), 'a')).toMatchObject({ ok: false });
    expect(captureResultFrom(reply('a', { imageDataUrl: 'data:image/jpeg;base64,<script>' }), 'a')).toMatchObject({ ok: false });
  });

  it('words a browser that cannot read back a rendered page plainly', () => {
    expect(captureResultFrom(reply('a', { error: PREVIEW_CAPTURE_UNSUPPORTED }), 'a')).toEqual({ ok: false, error: CAPTURE_UNSUPPORTED });
  });
});

describe('askPreviewFrame — only the preview origin may answer', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('ignores a forged reply from a frame that navigated elsewhere, takes the real one', async () => {
    const pending = askPreviewFrame<string>({
      url: 'https://preview.test/app/',
      width: 100,
      height: 100,
      title: 'capture-test',
      message: { type: 'ask' },
      parse: (data) => (data && typeof data === 'object' && (data as { answer?: unknown }).answer
        ? { ok: true, value: String((data as { answer: unknown }).answer) }
        : undefined),
      timeoutMs: 2_000,
      timeoutMessage: 'timed out',
    }, 'failed');
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="capture-test"]')!;
    let settled: string | undefined;
    void pending.then((value) => { settled = value; });

    window.dispatchEvent(new MessageEvent('message', { data: { answer: 'forged' }, origin: 'https://evil.test', source: frame.contentWindow }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBeUndefined();

    window.dispatchEvent(new MessageEvent('message', { data: { answer: 'real' }, origin: 'https://preview.test', source: frame.contentWindow }));
    expect(await pending).toBe('real');
  });
});
