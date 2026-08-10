import { describe, expect, it } from 'vitest';
import {
  assetUrl,
  extractMergeFields,
  logoPrompt,
  resolveAssetOrigin,
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
