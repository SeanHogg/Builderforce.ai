/**
 * The visual patch (PRD 33 §5.2 "Render"): validation rejects anything outside the
 * allow-lists — scripts, `on*` handlers, external URLs, disallowed properties,
 * colours outside the palette, selectors the rect map does not name — and
 * `applyVisualPatch` performs each op. The package has no DOM environment, so the
 * ops are applied to a minimal fake document that satisfies `PatchDocument`.
 */
import { describe, expect, it } from 'vitest';
import { deriveSelector } from './selector';
import {
  applyVisualPatch,
  patchCallouts,
  sanitizePatchHtml,
  validateVisualPatch,
  type PatchElement,
  type VisualPatch,
} from './visualPatch';

class FakeEl implements PatchElement {
  readonly nodeType = 1;
  id = '';
  parentElement: FakeEl | null = null;
  children: FakeEl[] = [];
  styles: Record<string, string> = {};
  inserted: string[] = [];
  private ownText: string;
  readonly style = { setProperty: (property: string, value: string) => { this.styles[property] = value; } };

  constructor(readonly tagName: string, private attrs: Record<string, string> = {}, text = '', children: FakeEl[] = []) {
    this.ownText = text;
    for (const child of children) this.append(child);
  }

  get textContent(): string | null {
    return this.ownText + this.children.map((c) => c.textContent ?? '').join('');
  }

  set textContent(value: string | null) {
    this.ownText = value ?? '';
    this.children = [];
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  append(child: FakeEl): void {
    child.parentElement?.remove(child);
    child.parentElement = this;
    this.children.push(child);
  }

  remove(child: FakeEl): void {
    this.children = this.children.filter((c) => c !== child);
    child.parentElement = null;
  }

  private insertAt(node: FakeEl, offset: number): void {
    const parent = this.parentElement!;
    node.parentElement?.remove(node);
    const at = parent.children.indexOf(this) + offset;
    parent.children.splice(at, 0, node);
    node.parentElement = parent;
  }

  before(node: FakeEl): void {
    this.insertAt(node, 0);
  }

  after(node: FakeEl): void {
    this.insertAt(node, 1);
  }

  insertAdjacentHTML(_position: 'afterend', html: string): void {
    this.inserted.push(html);
  }

  descendants(): FakeEl[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
}

function page() {
  const h1 = new FakeEl('H1', {}, 'Welcome');
  const lede = new FakeEl('P', { 'data-testid': 'lede' }, 'We make things');
  const cta = new FakeEl('BUTTON', {}, 'Click here');
  const hero = new FakeEl('IMG', { 'data-testid': 'hero' });
  const body = new FakeEl('BODY', {}, '', [h1, lede, hero, cta]);
  const doc = { querySelectorAll: (q: string) => (q === 'body *' ? body.descendants() : []) };
  const sel = (el: FakeEl) => deriveSelector(el).selector;
  const rects = [h1, lede, cta, hero].map((el) => ({ selector: sel(el), x: 0, y: 0, w: 10, h: 10, label: '', role: 'section' }));
  return { doc, body, h1, lede, cta, hero, sel, rects };
}

const PALETTE = ['#112233', '#FFF', 'rgb(10, 20, 30)'];
const ORIGIN = 'https://shop.example';

describe('validateVisualPatch', () => {
  const { rects, sel, cta, lede, h1 } = page();
  const ok = (patch: unknown) => validateVisualPatch(patch, rects, PALETTE, { origin: ORIGIN });

  it('accepts a patch inside the allow-lists', () => {
    expect(ok({
      ops: [
        { op: 'setText', selector: sel(cta), text: 'Start your free trial' },
        { op: 'setAttr', selector: sel(cta), name: 'aria-label', value: 'Start your free trial' },
        { op: 'setAttr', selector: sel(lede), name: 'href', value: '/pricing' },
        { op: 'setAttr', selector: sel(lede), name: 'href', value: 'https://shop.example/pricing' },
        { op: 'setStyle', selector: sel(cta), property: 'background-color', value: '#ffffff' },
        { op: 'setStyle', selector: sel(cta), property: 'padding', value: '12px 24px' },
        { op: 'moveBefore', selector: sel(cta), anchor: sel(lede) },
        { op: 'insertAfter', selector: sel(h1), html: '<p style="color: rgb(10,20,30)">Free for <strong>30 days</strong></p>' },
        { op: 'hide', selector: sel(lede) },
      ],
    })).toEqual({ ok: true });
  });

  it('rejects scripts and event handlers in inserted HTML', () => {
    expect(ok({ ops: [{ op: 'insertAfter', selector: sel(h1), html: '<script>alert(1)</script>' }] })).toMatchObject({ ok: false });
    expect(ok({ ops: [{ op: 'insertAfter', selector: sel(h1), html: '<p onclick="steal()">Hi</p>' }] })).toMatchObject({ ok: false, reason: expect.stringMatching(/event handlers/) });
    expect(ok({ ops: [{ op: 'insertAfter', selector: sel(h1), html: '<!-- x --><p>Hi</p>' }] })).toMatchObject({ ok: false });
    expect(ok({ ops: [{ op: 'insertAfter', selector: sel(h1), html: '<img src=x>' }] })).toMatchObject({ ok: false });
    expect(ok({ ops: [{ op: 'setText', selector: sel(h1), text: '<b>bold</b>' }] })).toMatchObject({ ok: false });
  });

  it('rejects external and script URLs', () => {
    expect(ok({ ops: [{ op: 'setAttr', selector: sel(lede), name: 'href', value: 'https://evil.example/x' }] })).toMatchObject({ ok: false });
    expect(ok({ ops: [{ op: 'setAttr', selector: sel(lede), name: 'href', value: '//evil.example/x' }] })).toMatchObject({ ok: false });
    expect(ok({ ops: [{ op: 'setAttr', selector: sel(lede), name: 'href', value: 'javascript:alert(1)' }] })).toMatchObject({ ok: false });
    expect(ok({ ops: [{ op: 'insertAfter', selector: sel(h1), html: '<a href="https://evil.example">x</a>' }] })).toMatchObject({ ok: false });
  });

  it('rejects disallowed properties, attributes and off-palette colours', () => {
    expect(ok({ ops: [{ op: 'setStyle', selector: sel(cta), property: 'position', value: 'fixed' }] })).toMatchObject({ ok: false });
    expect(ok({ ops: [{ op: 'setStyle', selector: sel(cta), property: 'width', value: 'url(x)' }] })).toMatchObject({ ok: false });
    expect(ok({ ops: [{ op: 'setStyle', selector: sel(cta), property: 'color', value: '#ff0000' }] })).toMatchObject({ ok: false, reason: expect.stringMatching(/palette/) });
    expect(ok({ ops: [{ op: 'setAttr', selector: sel(cta), name: 'onclick', value: 'x()' }] })).toMatchObject({ ok: false });
    expect(ok({ ops: [{ op: 'insertAfter', selector: sel(h1), html: '<p style="position: absolute">x</p>' }] })).toMatchObject({ ok: false });
  });

  it('rejects selectors the rect map does not name', () => {
    expect(ok({ ops: [{ op: 'hide', selector: 'getByText("Nowhere")' }] })).toMatchObject({ ok: false, reason: expect.stringMatching(/unknown selector/) });
    expect(ok({ ops: [{ op: 'moveAfter', selector: sel(cta), anchor: 'div#ghost' }] })).toMatchObject({ ok: false, reason: expect.stringMatching(/unknown anchor/) });
    expect(ok({ ops: [] })).toMatchObject({ ok: false });
    expect(ok({ ops: [{ op: 'remove', selector: sel(cta) }] })).toMatchObject({ ok: false });
  });
});

describe('sanitizePatchHtml', () => {
  it('rebuilds the fragment from the allow-list and escapes text', () => {
    const out = sanitizePatchHtml('<p title="a &quot;b&quot;">Tom & Jerry > all</p><br>', { palette: null, origin: null });
    expect(out).toEqual({ ok: true, html: '<p title="a &amp;quot;b&amp;quot;">Tom &amp; Jerry &gt; all</p><br>' });
  });

  it('refuses unbalanced markup', () => {
    expect(sanitizePatchHtml('<p><strong>x</p>', { palette: null, origin: null })).toMatchObject({ ok: false });
    expect(sanitizePatchHtml('<p>open', { palette: null, origin: null })).toMatchObject({ ok: false });
  });
});

describe('applyVisualPatch', () => {
  it('performs each op on the document', () => {
    const { doc, body, h1, lede, cta, hero, sel } = page();
    const patch: VisualPatch = {
      ops: [
        { op: 'setText', selector: sel(cta), text: 'Start free trial' },
        { op: 'setAttr', selector: sel(hero), name: 'alt', value: 'A happy customer' },
        { op: 'setStyle', selector: sel(cta), property: 'Background-Color', value: ' #112233 ' },
        { op: 'moveBefore', selector: sel(cta), anchor: sel(lede) },
        { op: 'moveAfter', selector: sel(hero), anchor: sel(h1) },
        { op: 'insertAfter', selector: sel(h1), html: '<p>Trusted by <strong>2,000</strong> teams</p>' },
        { op: 'hide', selector: sel(lede) },
      ],
    };
    const result = applyVisualPatch(doc, patch);
    expect(result).toEqual({ applied: 7, skipped: [] });
    expect(cta.textContent).toBe('Start free trial');
    expect(hero.getAttribute('alt')).toBe('A happy customer');
    expect(cta.styles['background-color']).toBe('#112233');
    expect(lede.styles.display).toBe('none');
    expect(h1.inserted).toEqual(['<p>Trusted by <strong>2,000</strong> teams</p>']);
    // h1, hero (moved after h1), cta (moved before lede), lede
    expect(body.children).toEqual([h1, hero, cta, lede]);
  });

  it('skips an op whose element is gone and refuses unsafe HTML even unvalidated', () => {
    const { doc, h1, sel } = page();
    const result = applyVisualPatch(doc, {
      ops: [
        { op: 'hide', selector: 'getByText("Missing")' },
        { op: 'insertAfter', selector: sel(h1), html: '<script>x()</script>' },
      ],
    });
    expect(result.applied).toBe(0);
    expect(result.skipped).toEqual(['getByText("Missing")', sel(h1)]);
    expect(h1.inserted).toEqual([]);
  });
});

describe('patchCallouts', () => {
  it('numbers each distinct element in op order', () => {
    expect(patchCallouts({
      ops: [
        { op: 'setText', selector: 'a', text: 'x' },
        { op: 'hide', selector: 'b' },
        { op: 'setStyle', selector: 'a', property: 'width', value: '10px' },
      ],
    })).toEqual([{ n: 1, selector: 'a' }, { n: 2, selector: 'b' }]);
  });
});
