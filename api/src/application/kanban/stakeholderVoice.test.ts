import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveTicketCoordinator = vi.fn();
vi.mock('./ticketCoordinator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ticketCoordinator')>()),
  resolveTicketCoordinator: (...a: unknown[]) => resolveTicketCoordinator(...a),
}));

import { resolveStakeholderVoice } from './stakeholderVoice';

const db = {} as never;

beforeEach(() => vi.clearAllMocks());

describe('resolveStakeholderVoice', () => {
  it('names the Coordinator on behalf of the acting agent', async () => {
    resolveTicketCoordinator.mockResolvedValue({ kind: 'human', ref: 'u:1', label: 'Dana' });
    await expect(resolveStakeholderVoice(db, { tenantId: 1, taskId: 9, actingLabel: 'Builder Bot' }))
      .resolves.toBe('Dana (on behalf of Builder Bot)');
    expect(resolveTicketCoordinator).toHaveBeenCalledWith(db, 1, 9);
  });

  it('keeps the acting label when the ticket has no Coordinator', async () => {
    resolveTicketCoordinator.mockResolvedValue(null);
    await expect(resolveStakeholderVoice(db, { tenantId: 1, taskId: 9, actingLabel: 'Builder Bot' })).resolves.toBe('Builder Bot');
  });

  it('collapses to one name when the Coordinator IS the acting label', async () => {
    resolveTicketCoordinator.mockResolvedValue({ kind: 'agent', ref: 'a1', label: 'Builder Bot' });
    await expect(resolveStakeholderVoice(db, { tenantId: 1, taskId: 9, actingLabel: 'Builder Bot' })).resolves.toBe('Builder Bot');
  });

  it('keeps the label, without a lookup, when the message is not ticket-scoped', async () => {
    for (const taskId of [null, undefined, 0, -3, 1.5]) {
      await expect(resolveStakeholderVoice(db, { tenantId: 1, taskId, actingLabel: 'Bot' })).resolves.toBe('Bot');
    }
    expect(resolveTicketCoordinator).not.toHaveBeenCalled();
  });

  it('keeps the label when the lookup fails', async () => {
    resolveTicketCoordinator.mockRejectedValue(new Error('db down'));
    await expect(resolveStakeholderVoice(db, { tenantId: 1, taskId: 9, actingLabel: 'Bot' })).resolves.toBe('Bot');
  });
});
