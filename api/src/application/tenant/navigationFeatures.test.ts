import { describe, expect, it } from 'vitest';
import {
  NAVIGATION_FEATURE_IDS,
  readNavigationFeatures,
  validateNavigationFeatures,
  writeNavigationFeatures,
} from './navigationFeatures';

describe('navigation features', () => {
  it('defaults existing workspaces to every module', () => {
    expect(readNavigationFeatures(null)).toEqual(NAVIGATION_FEATURE_IDS);
    expect(readNavigationFeatures('{"other":true}')).toEqual(NAVIGATION_FEATURE_IDS);
  });

  it('normalizes order, removes duplicates, and rejects unknown ids', () => {
    expect(validateNavigationFeatures(['knowledge', 'projects', 'knowledge'])).toEqual(['projects', 'knowledge']);
    expect(validateNavigationFeatures(['projects', 'unknown'])).toBeNull();
    expect(validateNavigationFeatures('projects')).toBeNull();
  });

  it('preserves unrelated tenant settings', () => {
    const raw = writeNavigationFeatures('{"embed":{"enabled":true}}', ['projects']);
    expect(JSON.parse(raw)).toEqual({ embed: { enabled: true }, navigationFeatures: ['projects'] });
    expect(readNavigationFeatures(raw)).toEqual(['projects']);
  });
});
