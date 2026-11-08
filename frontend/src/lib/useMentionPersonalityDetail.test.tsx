/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadAssigneeProfileMap: vi.fn(),
  loadPsychometricCatalog: vi.fn(),
  personalityOneLiner: vi.fn(),
  t: (key: string) => key,
}));

vi.mock('next-intl', () => ({ useTranslations: () => mocks.t }));
vi.mock('@/lib/AuthContext', () => ({ useOptionalAuth: () => ({ tenant: { id: 7 } }) }));
vi.mock('@/lib/assigneeProfilesCache', () => ({ loadAssigneeProfileMap: mocks.loadAssigneeProfileMap }));
vi.mock('@/lib/usePsychometricCatalog', () => ({ loadPsychometricCatalog: mocks.loadPsychometricCatalog }));
vi.mock('@/lib/personalityOneLiner', () => ({ personalityOneLiner: mocks.personalityOneLiner }));

import { useMentionPersonalityDetail } from './useMentionPersonalityDetail';

const human = { kind: 'human', ref: 'u1' } as never;
const agent = { kind: 'cloud_agent', ref: 'a1' } as never;

beforeEach(() => {
  mocks.loadAssigneeProfileMap.mockReset();
  mocks.loadPsychometricCatalog.mockReset();
  mocks.personalityOneLiner.mockReset();
  mocks.loadPsychometricCatalog.mockResolvedValue({});
  mocks.personalityOneLiner.mockReturnValue('Calm, curious');
});

describe('useMentionPersonalityDetail', () => {
  it('loads nothing while disabled', () => {
    renderHook(() => useMentionPersonalityDetail(false));
    expect(mocks.loadAssigneeProfileMap).not.toHaveBeenCalled();
    expect(mocks.loadPsychometricCatalog).not.toHaveBeenCalled();
  });

  it('looks up the one-liner by select-value (u: humans, c: cloud agents) from the cached map', async () => {
    mocks.loadAssigneeProfileMap.mockResolvedValue({ 'u:u1': { psychometric: { mbti: 'INTJ' } } });
    const { result } = renderHook(() => useMentionPersonalityDetail(true));
    await waitFor(() => expect(result.current(human)).toBe('Calm, curious'));
    expect(mocks.loadAssigneeProfileMap).toHaveBeenCalledWith('7');
    expect(result.current(agent)).toBeUndefined();
  });

  it('yields undefined when the one-liner is empty', async () => {
    mocks.loadAssigneeProfileMap.mockResolvedValue({ 'u:u1': { psychometric: {} } });
    mocks.personalityOneLiner.mockReturnValue('');
    const { result } = renderHook(() => useMentionPersonalityDetail(true));
    await waitFor(() => {
      result.current(human);
      expect(mocks.personalityOneLiner).toHaveBeenCalled();
    });
    expect(result.current(human)).toBeUndefined();
  });

  it('leaves the dropdown untouched when the map fails to load', async () => {
    mocks.loadAssigneeProfileMap.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useMentionPersonalityDetail(true));
    await waitFor(() => expect(mocks.loadAssigneeProfileMap).toHaveBeenCalled());
    expect(result.current(human)).toBeUndefined();
  });
});
