import { describe, expect, it } from 'vitest';
import { modelMatchesPriceLimits, type ModelRecord } from './modelCatalog';

const model = {
  id: 'vendor/model',
  name: 'Model',
  provider: 'Vendor',
  description: '',
  contextLength: 128_000,
  pricing: { prompt: 2 / 1_000_000, completion: 8 / 1_000_000 },
} satisfies ModelRecord;

describe('modelMatchesPriceLimits', () => {
  it('accepts a model when both displayed prices are within their ceilings', () => {
    expect(modelMatchesPriceLimits(model, 2, 10)).toBe(true);
  });

  it('applies input and output ceilings independently', () => {
    expect(modelMatchesPriceLimits(model, 1, 10)).toBe(false);
    expect(modelMatchesPriceLimits(model, 5, 5)).toBe(false);
  });

  it('leaves a price dimension unrestricted when its ceiling is omitted', () => {
    expect(modelMatchesPriceLimits(model, 2)).toBe(true);
    expect(modelMatchesPriceLimits(model, undefined, 5)).toBe(false);
  });
});
