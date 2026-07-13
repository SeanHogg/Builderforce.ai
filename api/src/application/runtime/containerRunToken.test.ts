import { describe, it, expect } from 'vitest';
import { mintContainerRunToken, verifyContainerRunToken } from './containerRunToken';

const SECRET = 'test-secret-please-ignore';

describe('containerRunToken', () => {
  it('a minted token verifies for the same execution id', async () => {
    const token = await mintContainerRunToken(SECRET, 28);
    expect(await verifyContainerRunToken(SECRET, 28, token)).toBe(true);
  });

  it('is bound to the execution id — a token for one run does not verify another', async () => {
    const token = await mintContainerRunToken(SECRET, 28);
    expect(await verifyContainerRunToken(SECRET, 29, token)).toBe(false);
  });

  it('rejects a token minted under a different secret', async () => {
    const token = await mintContainerRunToken('other-secret', 28);
    expect(await verifyContainerRunToken(SECRET, 28, token)).toBe(false);
  });

  it('rejects empty / malformed tokens without throwing', async () => {
    expect(await verifyContainerRunToken(SECRET, 28, '')).toBe(false);
    expect(await verifyContainerRunToken(SECRET, 28, 'deadbeef')).toBe(false);
  });
});
