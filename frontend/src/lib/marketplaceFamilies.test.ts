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
