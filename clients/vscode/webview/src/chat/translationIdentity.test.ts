import { describe, expect, it } from 'vitest';
import { translationIdentityOf } from './translationIdentity';

describe('translationIdentityOf', () => {
  it('regression: user A → sign out → user B are three distinct identities, so the cache is cleared for B', () => {
    const a = translationIdentityOf(true, 'user-a');
    const out = translationIdentityOf(false, 'user-a');
    const b = translationIdentityOf(true, 'user-b');
    expect(a).toBe('user-a');
    expect(out).toBeNull();
    expect(b).toBe('user-b');
    // The old constant ('signed-in') made A and B the same identity: nothing was cleared.
    expect(a).not.toBe(b);
  });

  it('is null while signed out, whatever token is still around', () => {
    expect(translationIdentityOf(undefined, 'user-a')).toBeNull();
    expect(translationIdentityOf(false, null)).toBeNull();
  });
});
