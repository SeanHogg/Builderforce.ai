import { describe, it, expect } from 'vitest';
import { apiSocketOrigin, apiSocketUrl } from './apiSocket';

describe('apiSocketOrigin', () => {
  it('rewrites the http(s) API origin to ws(s), with no trailing slash', () => {
    // AUTH_API_URL defaults to the production API when no env override is set,
    // which is the case in this test environment — asserting against the literal
    // keeps the test honest about what a real deployment sees.
    expect(apiSocketOrigin()).toBe('wss://api.builderforce.ai');
  });
});

describe('apiSocketUrl', () => {
  it('joins the origin and path with no params', () => {
    expect(apiSocketUrl('/api/collab/knowledge:1')).toBe('wss://api.builderforce.ai/api/collab/knowledge:1');
  });

  it('encodes and appends params', () => {
    expect(apiSocketUrl('/api/x', { token: 'a b', name: 'Ann' }))
      .toBe('wss://api.builderforce.ai/api/x?token=a+b&name=Ann');
  });

  it('drops undefined and null params instead of serialising the string "undefined"', () => {
    // This is the exact bug the eight hand-rolled copies were prone to: forgetting
    // to check a token before interpolating it.
    expect(apiSocketUrl('/api/x', { token: undefined, name: null, channel: 'chat' }))
      .toBe('wss://api.builderforce.ai/api/x?channel=chat');
  });

  it('drops an empty string the same way — an empty token is not a token', () => {
    expect(apiSocketUrl('/api/x', { token: '' })).toBe('wss://api.builderforce.ai/api/x');
  });
});
