import { describe, expect, it } from 'vitest';
import type { ElementFacts } from '../page/pageProtocol';
import { classifyAction, isSensitiveField, looksLikeCardNumber, originOf, type SafetyContext } from './safety';
import { ADD_TASK_TOOL, BROWSER_TOOL } from './toolNames';

const facts = (over: Partial<ElementFacts>): ElementFacts => ({
  ref: 'e1',
  tag: 'button',
  role: 'button',
  name: 'Next',
  inputType: '',
  autocomplete: '',
  fieldName: '',
  submitsForm: false,
  href: '',
  inert: false,
  ...over,
});

const ctx = (elements: ElementFacts[] = [], url = 'https://shop.example/cart', allowed = ['https://shop.example']): SafetyContext => ({
  url,
  allowedOrigins: new Set(allowed),
  factsFor: (ref) => elements.find((e) => e.ref === ref),
});

describe('safety gate', () => {
  it('lets a read on an allowed site run on its own', () => {
    expect(classifyAction(BROWSER_TOOL.read, {}, ctx())).toEqual([]);
    expect(classifyAction(BROWSER_TOOL.find, { query: 'price' }, ctx())).toEqual([]);
  });

  it('asks before reading or acting on a site that is not allowed', () => {
    expect(classifyAction(BROWSER_TOOL.read, {}, ctx([], 'https://other.example/'))).toEqual(['site_not_allowed']);
    expect(classifyAction(BROWSER_TOOL.screenshot, {}, ctx([], 'chrome://settings'))).toEqual(['site_not_allowed']);
  });

  it('asks before navigating to a site that is not allowed, not to one that is', () => {
    expect(classifyAction(BROWSER_TOOL.navigate, { url: 'https://evil.example/x' }, ctx())).toEqual(['site_not_allowed']);
    expect(classifyAction(BROWSER_TOOL.navigate, { url: 'https://shop.example/orders' }, ctx())).toEqual([]);
    expect(classifyAction(BROWSER_TOOL.navigate, { url: 'javascript:alert(1)' }, ctx())).toEqual(['site_not_allowed']);
  });

  it('lets an ordinary click run, and fails closed on an element Rovr never looked at', () => {
    expect(classifyAction(BROWSER_TOOL.click, { ref: 'e1' }, ctx([facts({})]))).toEqual([]);
    expect(classifyAction(BROWSER_TOOL.click, { ref: 'e99' }, ctx([facts({})]))).toEqual(['unknown_element']);
  });

  it('asks before submitting, buying, sending or deleting', () => {
    expect(classifyAction(BROWSER_TOOL.click, { ref: 'e1' }, ctx([facts({ submitsForm: true, name: 'Continue' })]))).toEqual(['submit']);
    expect(classifyAction(BROWSER_TOOL.click, { ref: 'e1' }, ctx([facts({ name: 'Place your order' })]))).toContain('purchase');
    expect(classifyAction(BROWSER_TOOL.click, { ref: 'e1' }, ctx([facts({ name: 'Jetzt kaufen' })]))).toContain('purchase');
    expect(classifyAction(BROWSER_TOOL.click, { ref: 'e1' }, ctx([facts({ name: 'Send' })]))).toContain('send');
    expect(classifyAction(BROWSER_TOOL.click, { ref: 'e1' }, ctx([facts({ name: '发送' })]))).toContain('send');
    expect(classifyAction(BROWSER_TOOL.click, { ref: 'e1' }, ctx([facts({ name: 'Delete account' })]))).toContain('destructive');
  });

  it('asks before typing into a password or payment field, or typing a card number anywhere', () => {
    const field = (over: Partial<ElementFacts>) => ctx([facts({ tag: 'input', role: 'textbox', name: 'Field', ...over })]);
    expect(classifyAction(BROWSER_TOOL.type, { ref: 'e1', text: 'x' }, field({ inputType: 'password' }))).toEqual(['sensitive_field']);
    expect(classifyAction(BROWSER_TOOL.type, { ref: 'e1', text: 'x' }, field({ autocomplete: 'cc-number' }))).toEqual(['sensitive_field']);
    expect(classifyAction(BROWSER_TOOL.type, { ref: 'e1', text: 'x' }, field({ fieldName: 'cvv' }))).toEqual(['sensitive_field']);
    expect(classifyAction(BROWSER_TOOL.type, { ref: 'e1', text: '4111 1111 1111 1111' }, field({ inputType: 'text' }))).toEqual(['sensitive_field']);
    expect(classifyAction(BROWSER_TOOL.type, { ref: 'e1', text: 'hello', submit: true }, field({ inputType: 'search' }))).toEqual(['submit']);
    expect(classifyAction(BROWSER_TOOL.type, { ref: 'e1', text: 'hello' }, field({ inputType: 'search' }))).toEqual([]);
  });

  it('does not judge tools that are not browser actions', () => {
    expect(classifyAction(ADD_TASK_TOOL, { title: 'x' }, ctx([], 'https://other.example'))).toEqual([]);
    expect(classifyAction(BROWSER_TOOL.listTabs, {}, ctx([], null as unknown as string))).toEqual([]);
  });

  it('reads card numbers by the Luhn check, not by length alone', () => {
    expect(looksLikeCardNumber('5555-5555-5555-4444')).toBe(true);
    expect(looksLikeCardNumber('order 1234 5678 9012 3456')).toBe(false);
    expect(looksLikeCardNumber('call 555 0100')).toBe(false);
  });

  it('knows a sensitive field from its markup', () => {
    expect(isSensitiveField(facts({ inputType: 'password' }))).toBe(true);
    expect(isSensitiveField(facts({ autocomplete: 'one-time-code' }))).toBe(true);
    expect(isSensitiveField(facts({ fieldName: 'email' }))).toBe(false);
  });

  it('reduces URLs to http(s) origins only', () => {
    expect(originOf('https://a.example/x?y')).toBe('https://a.example');
    expect(originOf('file:///etc/passwd')).toBeNull();
    expect(originOf('not a url')).toBeNull();
  });
});
