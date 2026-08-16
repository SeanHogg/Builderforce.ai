import { describe, expect, it } from 'vitest';
import {
  assetMediaClass,
  assetTooLargeMessage,
  assetUrl,
  extractMergeFields,
  isAssetKind,
  logoPrompt,
  maxAssetBytes,
  resolveAssetOrigin,
  readMediaSource,
  sanitizeTemplateHtml,
} from './templateLibrary';

/**
 * `sanitizeTemplateHtml` is a SECURITY BOUNDARY, not a formatter.
 *
 * An imported template is arbitrary HTML from outside the product, and it is
 * rendered back into an authenticated preview inside our own app. Sanitizing on
 * WRITE is what makes that safe: sanitizing on read would mean the dangerous
 * version is what is stored, and one forgotten call site is a stored XSS.
 *
 * These cases are the obfuscations a naive literal-match sanitizer misses.
 */
describe('sanitizeTemplateHtml', () => {
  it('removes a script element AND its body', () => {
    const out = sanitizeTemplateHtml('<p>Hi</p><script>alert(1)</script><p>Bye</p>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('<p>Hi</p>');
    expect(out).toContain('<p>Bye</p>');
  });

  it('removes an UNTERMINATED script tag, which a paired-only regex would leave', () => {
    expect(sanitizeTemplateHtml('<p>Hi</p><script src="https://evil.test/x.js">'))
      .not.toContain('script');
  });

  it('removes iframes, objects, embeds and forms', () => {
    const out = sanitizeTemplateHtml(
      '<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="x"><form action="/steal"></form>',
    );
    for (const tag of ['iframe', 'object', 'embed', 'form']) expect(out).not.toContain(tag);
  });

  it('strips inline event handlers whether quoted, single-quoted or bare', () => {
    const out = sanitizeTemplateHtml(
      '<div onclick="steal()"><a onmouseover=\'steal()\'>a</a><b onerror=steal()>b</b></div>',
    );
    expect(out).not.toMatch(/on(click|mouseover|error)/i);
    // The elements themselves survive — this is a sanitizer, not a stripper.
    expect(out).toContain('<div');
    expect(out).toContain('<a');
  });

  it('neutralises javascript: URLs INCLUDING whitespace-obfuscated ones', () => {
    // `java\tscript:` is the classic bypass — browsers ignore the whitespace,
    // a literal `javascript:` match does not.
    const out = sanitizeTemplateHtml(
      '<a href="javascript:steal()">x</a><a href="java\tscript:steal()">y</a>',
    );
    expect(out.toLowerCase()).not.toContain('javascript:');
    expect(out).not.toMatch(/java\s*script\s*:/i);
  });

  it('neutralises a data:text/html src, which executes with the page origin', () => {
    expect(sanitizeTemplateHtml('<img src="data:text/html,<script>alert(1)</script>">'))
      .not.toContain('data:text/html');
  });

  it('keeps <style>, because an email template is mostly CSS…', () => {
    const out = sanitizeTemplateHtml('<style>.a{color:#111}</style><p class="a">Hi</p>');
    expect(out).toContain('<style>');
    expect(out).toContain('color:#111');
  });

  it('…but removes the CSS escape hatches inside it', () => {
    const out = sanitizeTemplateHtml('<style>@import url(//evil.test/x.css); .a{width:expression(alert(1))}</style>');
    expect(out).not.toContain('@import');
    expect(out).not.toContain('expression(');
  });

  it('leaves an ordinary marketing template untouched apart from trimming', () => {
    const html = '<table><tr><td style="color:#111"><a href="https://acme.test">Shop</a></td></tr></table>';
    expect(sanitizeTemplateHtml(`  ${html}  `)).toBe(html);
  });
});

/**
 * The merge-field list is the CONTRACT between a template and an audience. It
 * exists so the composer can warn an author before the send rather than after
 * 4,000 people receive the literal text `{{company}}`.
 */
describe('extractMergeFields', () => {
  it('finds fields in both the subject and the body, sorted and deduplicated', () => {
    expect(extractMergeFields('<p>{{company}} — {{plan}}</p>{{company}}', 'Hello {{firstName}}'))
      .toEqual(['company', 'firstName', 'plan']);
  });

  it('EXCLUDES the built-ins the renderer always supplies', () => {
    // Reporting these would tell an author to add columns they already have.
    expect(extractMergeFields('{{name}} {{email}} {{logo}} {{unsubscribe}} {{industry}}'))
      .toEqual(['industry']);
  });

  it('tolerates whitespace inside the braces, as the renderer does', () => {
    expect(extractMergeFields('{{  company  }}')).toEqual(['company']);
  });

  it('ignores anything that is not a plain identifier', () => {
    expect(extractMergeFields('{{ 1bad }} {{with-dash}} {{}} {{ }}')).toEqual([]);
  });
});

describe('assetUrl / resolveAssetOrigin', () => {
  it('uses the SAME origin resolver as the tracking links', () => {
    // Both must resolve identically: a template authored on a preview deploy and
    // sent from production would otherwise bake a dead host into delivered mail.
    expect(resolveAssetOrigin({})).toBe('https://builderforce.ai/gateway');
    expect(resolveAssetOrigin({ CAMPAIGN_TRACKING_ORIGIN: 'https://t.example.com/' }))
      .toBe('https://t.example.com');
  });

  it('addresses an asset by its token and nothing else', () => {
    expect(assetUrl('https://t.example.com/', 'tok123'))
      .toBe('https://t.example.com/api/campaign-assets/tok123');
  });
});

describe('logoPrompt', () => {
  it('states the negative constraints that make the output a usable logo', () => {
    const prompt = logoPrompt('a boutique coffee roaster');
    // Without these an image model returns a detailed scene with gibberish
    // lettering, which is unreadable at 40px in an email header.
    expect(prompt).toContain('a boutique coffee roaster');
    expect(prompt).toMatch(/no text/i);
    expect(prompt).toMatch(/40 pixels/i);
  });

  it('bounds the caller-supplied description and style', () => {
    const prompt = logoPrompt('x'.repeat(1_000), 'y'.repeat(500));
    expect(prompt).not.toContain('x'.repeat(401));
    expect(prompt).not.toContain('y'.repeat(121));
  });
});

/**
 * `readMediaSource` is the step between "the board made a picture" and "a social
 * network can fetch it", and it is a SECURITY BOUNDARY for the same reason
 * `sanitizeTemplateHtml` is: the URL it is handed comes from a person or a model,
 * and it is fetched server-side from inside the Workers runtime. The function it
 * replaced (`fetchGeneratedImage`) called bare `fetch` with no guard at all.
 */
describe('readMediaSource', () => {
  const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('decodes a base64 data URL — the shape a generated canvas image is in', async () => {
    const read = await readMediaSource(PNG_1PX);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.mimeType).toBe('image/png');
    expect(read.bytes.byteLength).toBeGreaterThan(0);
  });

  it('refuses an internal host rather than fetching it', async () => {
    for (const url of [
      'https://127.0.0.1/logo.png',
      'https://169.254.169.254/latest/meta-data/',
      'https://localhost/logo.png',
      'https://build.internal/logo.png',
    ]) {
      const read = await readMediaSource(url);
      expect(read.ok, url).toBe(false);
    }
  });

  it('refuses a protocol a server cannot read, by name', async () => {
    // A blob: URL exists only inside the tab that minted it, and a bare `fetch`
    // of one would fail deep in the runtime with nothing a user could act on.
    const blob = await readMediaSource('blob:https://builderforce.ai/8f2c');
    expect(blob.ok).toBe(false);
    const relative = await readMediaSource('/api/ide/projects/1/files/logo.png');
    expect(relative.ok).toBe(false);
  });

  it('refuses a type no network will render, before storing it', async () => {
    const read = await readMediaSource('data:application/pdf;base64,JVBERi0=');
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.status).toBe(400);
    expect(read.error).toContain('application/pdf');
  });

  it('refuses an oversized inline image with the size as the reason', async () => {
    // Base64 of ~3 MB of zero bytes — over the 2 MB ceiling the mail-client
    // limit set, which social publishing inherits.
    const oversized = `data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`;
    const read = await readMediaSource(oversized);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.status).toBe(413);
  });

  it('rejects an empty source instead of storing a zero-byte asset', async () => {
    expect((await readMediaSource('   ')).ok).toBe(false);
  });

  it('accepts a video, which is what makes TikTok reachable from the board', async () => {
    // TikTok publishes video ONLY, so an images-only store meant "post this clip"
    // had nowhere to put the clip and the target was skipped with a blocker
    // nobody could clear from the canvas.
    const read = await readMediaSource('data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28y');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.mimeType).toBe('video/mp4');
  });

  it('gives video its own ceiling rather than the mail-client one', async () => {
    // 3 MB is over the 2 MB IMAGE limit and well under the 32 MB video one. The
    // same payload therefore has to be refused as a picture and accepted as a
    // clip — which is the whole point of the ceiling being per media class.
    const payload = 'A'.repeat(4 * 1024 * 1024);
    expect((await readMediaSource(`data:image/png;base64,${payload}`)).ok).toBe(false);
    expect((await readMediaSource(`data:video/mp4;base64,${payload}`)).ok).toBe(true);
  });

});

describe('the media classes this store holds', () => {
  it('classifies by MIME type and nothing else', () => {
    expect(assetMediaClass('image/png')).toBe('image');
    expect(assetMediaClass('VIDEO/MP4')).toBe('video');
    expect(assetMediaClass('video/mp4; codecs=avc1')).toBe('video');
    expect(assetMediaClass('application/pdf')).toBeNull();
  });

  it('bounds video at 32 MB — this path buffers, so the limit is the isolate not TikTok', () => {
    // Asserted as a number rather than by decoding a 48 MB data URL: proving the
    // ceiling should not cost 17 seconds of base64 on every run.
    expect(maxAssetBytes('video/mp4')).toBe(32 * 1024 * 1024);
    expect(maxAssetBytes('image/png')).toBe(2 * 1024 * 1024);
  });

  it('gives an unknown type the SMALLEST ceiling, so an early size check still refuses', () => {
    // The upload route checks size before the store has judged the type, so the
    // fallback has to be the strict one — the alternative is buffering 32 MB of
    // something that was never going to be stored.
    expect(maxAssetBytes('application/octet-stream')).toBe(maxAssetBytes('image/png'));
    expect(maxAssetBytes('video/mp4')).toBeGreaterThan(maxAssetBytes('image/png'));
  });

  it('says the same sentence early and late', () => {
    // The route refuses an oversized upload before reading it; the store refuses
    // it after. Two wordings for one limit is how a 413 stops being actionable.
    expect(assetTooLargeMessage('video/mp4')).toContain('32 MB');
    expect(assetTooLargeMessage('image/png')).toContain('2 MB');
  });

  it('accepts only the three kinds a row may carry', () => {
    expect(isAssetKind('video')).toBe(true);
    expect(isAssetKind('logo')).toBe(true);
    expect(isAssetKind('image')).toBe(true);
    expect(isAssetKind('audio')).toBe(false);
  });
});
