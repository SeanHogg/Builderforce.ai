/**
 * The Jobs chip, as registry DATA: a kind on the talent family, a legacy
 * `?category=jobs` alias, and a publish route — no branch anywhere else.
 */
import { describe, it, expect } from 'vitest';
import { FAMILIES, publishActionFor, resolveFamily } from './marketplaceFamilies';

describe('the jobs kind', () => {
  it('is a chip of the talent family, beside gigs', () => {
    expect(FAMILIES.talent.kinds).toContain('job');
    expect(FAMILIES.talent.kinds.indexOf('job')).toBeGreaterThan(FAMILIES.talent.kinds.indexOf('gig'));
  });

  it('resolves from both vocabularies', () => {
    expect(resolveFamily('talent', 'job', null)).toEqual({ family: 'talent', kind: 'job' });
    expect(resolveFamily(null, null, 'jobs')).toEqual({ family: 'talent', kind: 'job' });
  });

  it('publishes through the same ticket-backed posting form as a gig', () => {
    expect(publishActionFor('talent', 'job')).toEqual(publishActionFor('talent', 'gig'));
  });
});

describe('the All view', () => {
  it('is what a bare /marketplace and the legacy ?category=all open on', () => {
    expect(resolveFamily(null, null, null)).toEqual({ family: 'all', kind: '' });
    expect(resolveFamily(null, null, 'all')).toEqual({ family: 'all', kind: '' });
    expect(resolveFamily('all', 'skill', null)).toEqual({ family: 'all', kind: '' });
  });

  it('has no kind chips of its own', () => {
    expect(FAMILIES.all.kinds).toEqual([]);
  });

  it('publishes on the canvas, the path every family shares, with no sign-in gate', () => {
    expect(publishActionFor('all', '')).toEqual({ via: 'route', href: '/create/new', requiresAuth: false });
  });
});
