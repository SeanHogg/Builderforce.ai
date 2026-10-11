import { describe, expect, it } from 'vitest';
import { deriveSelector, implicitRole, redactInput, type SelectorElement } from './selector';

function el(over: {
  tag: string;
  id?: string;
  attrs?: Record<string, string>;
  text?: string;
  parent?: SelectorElement | null;
}): SelectorElement {
  const attrs = over.attrs ?? {};
  return {
    tagName: over.tag.toUpperCase(),
    id: over.id ?? '',
    nodeType: 1,
    textContent: over.text ?? '',
    parentElement: over.parent ?? null,
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
  };
}

describe('deriveSelector', () => {
  it('prefers data-testid', () => {
    expect(deriveSelector(el({ tag: 'button', attrs: { 'data-testid': 'save' }, text: 'Save' }))).toEqual({
      selector: 'getByTestId("save")',
      label: 'save',
    });
  });

  it('accepts data-test-id as an alias', () => {
    expect(deriveSelector(el({ tag: 'div', attrs: { 'data-test-id': 'hero' } })).selector).toBe(
      'getByTestId("hero")',
    );
  });

  it('uses role + accessible name when both are present', () => {
    const result = deriveSelector(el({ tag: 'button', text: 'Save changes' }));
    expect(result.selector).toBe('getByRole("button", { name: "Save changes" })');
    expect(result.label).toBe('Save changes');
  });

  it('falls back to getByText when there is a name but no role', () => {
    expect(deriveSelector(el({ tag: 'span', text: 'Hello' })).selector).toBe('getByText("Hello")');
  });

  it('falls back to a short css path', () => {
    const parent = el({ tag: 'nav', id: 'main' });
    const child = el({ tag: 'div', parent, attrs: { class: 'item active' } });
    expect(deriveSelector(child).selector).toBe('nav#main > div.item');
  });
});

describe('implicitRole', () => {
  it('maps the tags the selector rule cares about', () => {
    expect(implicitRole(el({ tag: 'a' }))).toBe('link');
    expect(implicitRole(el({ tag: 'button' }))).toBe('button');
    expect(implicitRole(el({ tag: 'input', attrs: { type: 'checkbox' } }))).toBe('checkbox');
    expect(implicitRole(el({ tag: 'select' }))).toBe('combobox');
    expect(implicitRole(el({ tag: 'h2' }))).toBe('heading');
    expect(implicitRole(el({ tag: 'div' }))).toBeNull();
  });
});

describe('redactInput', () => {
  it('never records a password', () => {
    expect(redactInput({ value: 'secret', getAttribute: (n) => (n === 'type' ? 'password' : null) })).toBeNull();
  });

  it('emits name:type:len without the raw value', () => {
    expect(
      redactInput({
        value: 'hello world',
        getAttribute: (n) => (n === 'name' ? 'email' : n === 'type' ? 'email' : null),
      }),
    ).toBe('email:email:len11');
  });
});
