import { describe, it, expect } from 'vitest';
import { mapRegistrySkill, BUILTIN_SKILLS } from './skillsData';

// ---------------------------------------------------------------------------
// mapRegistrySkill — registry (snake_case) row → camelCase `Skill`.
// Guards the wiring that makes the "Newest" sort, author, icon, and the
// per-skill detail route resolve correctly from a live registry response.
// ---------------------------------------------------------------------------

describe('mapRegistrySkill', () => {
  it('maps a full registry row to the Skill shape', () => {
    const skill = mapRegistrySkill({
      id: 42,
      slug: 'my-skill',
      name: 'My Skill',
      description: 'Does a thing.',
      category: 'Development',
      tags: ['a', 'b'],
      likes: 10,
      downloads: 99,
      icon_url: 'https://cdn/icon.png',
      created_at: '2026-06-01T00:00:00.000Z',
      author_display_name: 'Ada Lovelace',
      author_username: 'ada',
    });

    // Route on the slug so the listing link resolves to the detail page.
    expect(skill.id).toBe('my-skill');
    expect(skill.name).toBe('My Skill');
    expect(skill.author).toBe('Ada Lovelace');
    expect(skill.image).toBe('https://cdn/icon.png');
    // created_at must surface as createdAt so the Newest sort has a date.
    expect(skill.createdAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('falls back through author fields and defaults', () => {
    const skill = mapRegistrySkill({ slug: 'x', author_username: 'neo' });
    expect(skill.author).toBe('neo');
    expect(skill.description).toBe('');

    const anon = mapRegistrySkill({ slug: 'y' });
    expect(anon.author).toBe('Community');
  });

  it('uses id as the slug fallback when slug is absent', () => {
    expect(mapRegistrySkill({ id: 7 }).id).toBe('7');
  });
});

describe('BUILTIN_SKILLS', () => {
  it('every built-in skill has a routable id', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(typeof s.id).toBe('string');
      expect(s.id.length).toBeGreaterThan(0);
    }
  });
});
