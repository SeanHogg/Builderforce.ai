import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../domain/shared/errors';
import { trustedReturnUrl } from './trustedReturnUrl';

const env = { CORS_ORIGINS: 'https://app.example.com', APP_URL: 'https://app.example.com' };

describe('trustedReturnUrl', () => {
  it('defaults to the web origin at the default path', () => {
    expect(trustedReturnUrl(env, undefined, '/marketplace').href).toBe('https://app.example.com/marketplace');
    expect(trustedReturnUrl({}, null).href).toBe('https://builderforce.ai/');
  });

  it('accepts the web origin, its studio sibling and local dev', () => {
    expect(trustedReturnUrl(env, 'https://app.example.com/workforce?x=1').origin).toBe('https://app.example.com');
    // `studio.` is derived from a two-label APEX only (appOrigins; cors.test.ts pins that rule).
    const apex = { CORS_ORIGINS: 'https://example.com', APP_URL: 'https://example.com' };
    expect(trustedReturnUrl(apex, 'https://studio.example.com/x').origin).toBe('https://studio.example.com');
    expect(trustedReturnUrl({ ...env, ENVIRONMENT: 'development' }, 'http://localhost:3000/x').origin).toBe('http://localhost:3000');
  });

  it('refuses localhost in production (or when the environment is unset)', () => {
    expect(() => trustedReturnUrl({ ...env, ENVIRONMENT: 'production' }, 'http://localhost:3000/x')).toThrow(ValidationError);
    expect(() => trustedReturnUrl(env, 'http://127.0.0.1:5173/x')).toThrow(ValidationError);
  });

  it('refuses a foreign origin with a 400-class ValidationError', () => {
    expect(() => trustedReturnUrl(env, 'https://evil.example/steal')).toThrow(ValidationError);
    expect(() => trustedReturnUrl(env, 'https://app.example.com.evil.example/x')).toThrow(ValidationError);
  });

  it('refuses a value that is not an absolute URL', () => {
    expect(() => trustedReturnUrl(env, 'not a url')).toThrow(ValidationError);
    expect(() => trustedReturnUrl(env, '/relative')).toThrow(ValidationError);
  });
});
