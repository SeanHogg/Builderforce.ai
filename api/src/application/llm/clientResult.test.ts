/**
 * `clientResult` — the ONE validator for a result the client produced on-device
 * (PRD 42 Part D). Provenance whitelist, text cap, json via the caller's validator.
 */
import { describe, expect, it } from 'vitest';
import {
  CLIENT_JSON_OBJECT_SPEC, CLIENT_RESULT_MODEL_MAX, parseClientResult, readClientResult,
} from './clientResult';

const provenance = { engine: 'webllm', model: 'Qwen-0.5B' };
const TEXT = { kind: 'text', maxChars: 20 } as const;
const isNumberArray = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number');
const JSON_SPEC = { kind: 'json', validate: isNumberArray } as const;

describe('parseClientResult: provenance', () => {
  it.each(['browser', 'bfi', 'webllm', 'synapse'])('accepts the %s engine', (engine) => {
    expect(parseClientResult({ text: 'hi', provenance: { engine, model: 'm' } }, TEXT)).toEqual({ ok: true, value: 'hi', provenance: { engine, model: 'm' } });
  });

  it('refuses a missing, unknown or non-string engine and a bad model', () => {
    expect(parseClientResult({ text: 'hi' }, TEXT)).toEqual({ ok: false, reason: 'provenance_required' });
    expect(parseClientResult({ text: 'hi', provenance: { engine: 'openai', model: 'm' } }, TEXT)).toEqual({ ok: false, reason: 'provenance_engine_invalid' });
    expect(parseClientResult({ text: 'hi', provenance: { engine: 7, model: 'm' } }, TEXT)).toEqual({ ok: false, reason: 'provenance_engine_invalid' });
    expect(parseClientResult({ text: 'hi', provenance: { engine: 'bfi', model: '' } }, TEXT)).toEqual({ ok: false, reason: 'provenance_model_invalid' });
    expect(parseClientResult({ text: 'hi', provenance: { engine: 'bfi', model: 'x'.repeat(CLIENT_RESULT_MODEL_MAX + 1) } }, TEXT)).toEqual({ ok: false, reason: 'provenance_model_invalid' });
    expect(parseClientResult({ text: 'hi', provenance: { engine: 'bfi', model: 'x'.repeat(CLIENT_RESULT_MODEL_MAX) } }, TEXT).ok).toBe(true);
  });

  it('refuses a non-object', () => {
    expect(parseClientResult('hi', TEXT)).toEqual({ ok: false, reason: 'not_an_object' });
    expect(parseClientResult([], TEXT)).toEqual({ ok: false, reason: 'not_an_object' });
  });
});

describe('parseClientResult: text', () => {
  it('trims, and enforces presence and the length cap', () => {
    expect(parseClientResult({ text: '  padded  ', provenance }, TEXT)).toMatchObject({ ok: true, value: 'padded' });
    expect(parseClientResult({ provenance }, TEXT)).toEqual({ ok: false, reason: 'text_required' });
    expect(parseClientResult({ text: '   ', provenance }, TEXT)).toEqual({ ok: false, reason: 'text_empty' });
    expect(parseClientResult({ text: 'x'.repeat(21), provenance }, TEXT)).toEqual({ ok: false, reason: 'text_too_long' });
    expect(parseClientResult({ text: 'x'.repeat(20), provenance }, TEXT).ok).toBe(true);
  });
});

describe('parseClientResult: json', () => {
  it('passes the value through the caller validator', () => {
    expect(parseClientResult({ json: [1, 2], provenance }, JSON_SPEC)).toMatchObject({ ok: true, value: [1, 2] });
    expect(parseClientResult({ json: ['a'], provenance }, JSON_SPEC)).toEqual({ ok: false, reason: 'json_invalid' });
    expect(parseClientResult({ provenance }, JSON_SPEC)).toEqual({ ok: false, reason: 'json_required' });
  });

  it('CLIENT_JSON_OBJECT_SPEC takes an object only', () => {
    expect(parseClientResult({ json: { rewrites: [] }, provenance }, CLIENT_JSON_OBJECT_SPEC).ok).toBe(true);
    expect(parseClientResult({ json: [], provenance }, CLIENT_JSON_OBJECT_SPEC).ok).toBe(false);
    expect(parseClientResult({ json: 'str', provenance }, CLIENT_JSON_OBJECT_SPEC).ok).toBe(false);
  });
});

describe('readClientResult', () => {
  it('is null when the body carried none, so the route runs as before', () => {
    expect(readClientResult(undefined, TEXT)).toBeNull();
    expect(readClientResult(null, TEXT)).toBeNull();
  });
  it('parses a present value', () => {
    expect(readClientResult({ text: 'hi', provenance }, TEXT)).toMatchObject({ ok: true });
    expect(readClientResult({ text: 'hi' }, TEXT)).toMatchObject({ ok: false });
  });
});
