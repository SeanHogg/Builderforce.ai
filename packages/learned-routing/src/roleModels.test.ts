import { describe, expect, it } from 'vitest';
import {
  parseRoleModelConfig,
  resolveModelForRole,
  ROLE_MODEL_DEFAULT_ENV,
  ROLE_MODELS_ENV,
} from './roleModels.js';

describe('resolveModelForRole', () => {
  const cfg = {
    byRole: {
      code: 'claude-opus-4-8',
      verify: 'gpt-4.1-mini',
      developer: 'claude-opus-4-8',
      'qa-tester': 'gpt-4.1-mini',
    },
    defaultModel: 'claude-sonnet-4-6',
  };

  it('override: a mapped role returns its catalog id', () => {
    expect(resolveModelForRole('code', cfg)).toBe('claude-opus-4-8');
    expect(resolveModelForRole('verify', cfg)).toBe('gpt-4.1-mini');
    expect(resolveModelForRole('developer', cfg)).toBe('claude-opus-4-8');
    expect(resolveModelForRole('qa-tester', cfg)).toBe('gpt-4.1-mini');
  });

  it('default: an unmapped / unknown / empty role uses defaultModel', () => {
    expect(resolveModelForRole('plan', cfg)).toBe('claude-sonnet-4-6');
    expect(resolveModelForRole('architect', cfg)).toBe('claude-sonnet-4-6');
    expect(resolveModelForRole('', cfg)).toBe('claude-sonnet-4-6');
    expect(resolveModelForRole(undefined, cfg)).toBe('claude-sonnet-4-6');
    expect(resolveModelForRole(null, cfg)).toBe('claude-sonnet-4-6');
  });

  it('documented default with no config is no pin', () => {
    expect(resolveModelForRole('code')).toBeUndefined();
    expect(resolveModelForRole('code', {})).toBeUndefined();
    expect(resolveModelForRole('code', { byRole: {} })).toBeUndefined();
  });

  it('ignores empty / whitespace mappings and falls through to the default', () => {
    expect(resolveModelForRole('code', { byRole: { code: '  ' }, defaultModel: 'sonnet' })).toBe('sonnet');
    expect(resolveModelForRole('code', { byRole: { code: '' } })).toBeUndefined();
    expect(resolveModelForRole('code', { defaultModel: '  ' })).toBeUndefined();
  });

  it('trims role keys and model ids', () => {
    expect(resolveModelForRole('  code  ', { byRole: { code: '  claude-opus-4-8  ' } })).toBe('claude-opus-4-8');
    expect(resolveModelForRole('verify', { defaultModel: '  gpt-4.1-mini  ' })).toBe('gpt-4.1-mini');
  });
});

describe('parseRoleModelConfig', () => {
  it('parses ROLE_MODELS JSON and ROLE_MODEL_DEFAULT', () => {
    expect(parseRoleModelConfig({
      [ROLE_MODELS_ENV]: '{"code":"claude-opus-4-8","verify":"gpt-4.1-mini"}',
      [ROLE_MODEL_DEFAULT_ENV]: 'claude-sonnet-4-6',
    })).toEqual({
      byRole: { code: 'claude-opus-4-8', verify: 'gpt-4.1-mini' },
      defaultModel: 'claude-sonnet-4-6',
    });
  });

  it('accepts an already-parsed ROLE_MODELS object', () => {
    expect(parseRoleModelConfig({
      [ROLE_MODELS_ENV]: { developer: 'claude-opus-4-8', 'qa-tester': 'gpt-4.1-mini' },
    })).toEqual({
      byRole: { developer: 'claude-opus-4-8', 'qa-tester': 'gpt-4.1-mini' },
    });
  });

  it('malformed / empty / missing config is the documented default (no pin)', () => {
    expect(parseRoleModelConfig(undefined)).toEqual({});
    expect(parseRoleModelConfig(null)).toEqual({});
    expect(parseRoleModelConfig({})).toEqual({});
    expect(parseRoleModelConfig({ [ROLE_MODELS_ENV]: '' })).toEqual({});
    expect(parseRoleModelConfig({ [ROLE_MODELS_ENV]: 'not-json' })).toEqual({});
    expect(parseRoleModelConfig({ [ROLE_MODELS_ENV]: '[]' })).toEqual({});
    expect(parseRoleModelConfig({ [ROLE_MODELS_ENV]: '{"code":""}' })).toEqual({});
    expect(parseRoleModelConfig({ [ROLE_MODEL_DEFAULT_ENV]: '  ' })).toEqual({});
  });

  it('drops blank keys and non-string values from a JSON object', () => {
    expect(parseRoleModelConfig({
      [ROLE_MODELS_ENV]: '{"code":"opus","  ":"ignored","verify":3,"plan":"sonnet"}',
    })).toEqual({
      byRole: { code: 'opus', plan: 'sonnet' },
    });
  });

  it('round-trips: parsed config feeds resolveModelForRole override + default', () => {
    const cfg = parseRoleModelConfig({
      [ROLE_MODELS_ENV]: '{"verify":"gpt-4.1-mini"}',
      [ROLE_MODEL_DEFAULT_ENV]: 'claude-sonnet-4-6',
    });
    expect(resolveModelForRole('verify', cfg)).toBe('gpt-4.1-mini');
    expect(resolveModelForRole('code', cfg)).toBe('claude-sonnet-4-6');
  });
});
