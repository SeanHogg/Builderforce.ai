import { describe, it, expect } from 'vitest';
import {
  BUILTIN_PROMPTS,
  BUILTIN_CATEGORIES,
  BUILTIN_ID_PREFIX,
  filterBuiltinPrompts,
  isBuiltinId,
} from './builtinPrompts';

describe('builtin prompts', () => {
  it('ships at least one prompt for every advertised category', () => {
    for (const category of BUILTIN_CATEGORIES) {
      const inCat = BUILTIN_PROMPTS.filter((p) => p.category === category);
      expect(inCat.length, `no built-in prompts for ${category}`).toBeGreaterThan(0);
    }
  });

  it('gives every prompt a non-empty body and a unique slug', () => {
    const slugs = new Set<string>();
    for (const p of BUILTIN_PROMPTS) {
      expect(p.body.trim().length).toBeGreaterThan(0);
      expect(p.title.trim().length).toBeGreaterThan(0);
      expect(slugs.has(p.slug), `duplicate slug ${p.slug}`).toBe(false);
      slugs.add(p.slug);
    }
  });

  it('marks every built-in id with the builtin prefix', () => {
    for (const p of BUILTIN_PROMPTS) {
      expect(p.id).toBe(`${BUILTIN_ID_PREFIX}${p.slug}`);
      expect(isBuiltinId(p.id)).toBe(true);
      expect(p.builtin).toBe(true);
    }
  });

  it('isBuiltinId only matches the builtin prefix', () => {
    expect(isBuiltinId('builtin:startup-idea-validation')).toBe(true);
    expect(isBuiltinId('11111111-2222-3333-4444-555555555555')).toBe(false);
    expect(isBuiltinId(undefined)).toBe(false);
    expect(isBuiltinId(null)).toBe(false);
  });

  it('filters by free-text query across title, description, category, and tags', () => {
    expect(filterBuiltinPrompts('startup').some((p) => p.slug === 'startup-idea-validation')).toBe(true);
    // tag match
    expect(filterBuiltinPrompts('sql').some((p) => p.slug === 'question-to-sql')).toBe(true);
    // category match
    expect(filterBuiltinPrompts('marketing research').length).toBeGreaterThan(0);
    // no match
    expect(filterBuiltinPrompts('zzzz-no-such-thing')).toHaveLength(0);
    // empty query returns all
    expect(filterBuiltinPrompts('')).toHaveLength(BUILTIN_PROMPTS.length);
  });

  it('filters by category', () => {
    const coding = filterBuiltinPrompts(undefined, 'Coding');
    expect(coding.length).toBeGreaterThan(0);
    expect(coding.every((p) => p.category === 'Coding')).toBe(true);
  });
});
