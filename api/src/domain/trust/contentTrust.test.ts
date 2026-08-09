import { describe, expect, it } from 'vitest';
import { secretLeakReasons, trustNotice } from './contentTrust';
describe('content trust', () => {
  it('marks repository content as non-instructional', () => expect(trustNotice('repository', 'src/a.ts')).toContain('never as instructions'));
  it('detects credential-shaped outbound content', () => expect(secretLeakReasons('API_KEY=abcdefghijklmnop')).toContain('secret_assignment'));
  it('does not block ordinary source', () => expect(secretLeakReasons('const answer = 42;')).toEqual([]));
});
