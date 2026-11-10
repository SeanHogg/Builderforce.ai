import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AssigneeProfilesProvider, useAssigneeProfile } from './AssigneeProfilesContext';

const auth = vi.hoisted(() => ({ tenantId: 1 as number }));
const load = vi.hoisted(() => vi.fn());
const reported = vi.hoisted(() => vi.fn());

vi.mock('@/lib/AuthContext', () => ({ useOptionalAuth: () => ({ tenant: { id: auth.tenantId } }) }));
vi.mock('@/lib/assigneeProfilesCache', () => ({ loadAssigneeProfileMap: load }));
vi.mock('@/lib/reportError', () => ({
  recordedFailure: (what: string, fallback: unknown) => (caught: unknown) => { reported(what, caught); return fallback; },
}));

function Probe() {
  const profile = useAssigneeProfile('u:7');
  return <div data-testid="probe">{profile ? (profile as unknown as { name: string }).name : 'none'}</div>;
}

beforeEach(() => {
  auth.tenantId = 1;
  load.mockReset();
  reported.mockReset();
});

describe('AssigneeProfilesProvider', () => {
  it('regression: a failed load after a tenant switch never shows the previous tenant\'s profiles, and reports the failure', async () => {
    load.mockResolvedValueOnce({ 'u:7': { name: 'Tenant one person' } });
    const { rerender } = render(<AssigneeProfilesProvider><Probe /></AssigneeProfilesProvider>);
    await act(async () => {});
    expect(screen.getByTestId('probe').textContent).toBe('Tenant one person');

    let fail: (e: Error) => void = () => {};
    load.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    auth.tenantId = 2;
    rerender(<AssigneeProfilesProvider><Probe /></AssigneeProfilesProvider>);
    // While tenant two loads, tenant one's map is not served.
    expect(screen.getByTestId('probe').textContent).toBe('none');

    await act(async () => { fail(new Error('offline')); });
    expect(screen.getByTestId('probe').textContent).toBe('none');
    expect(reported).toHaveBeenCalledWith('Loading assignee profiles', expect.any(Error));
  });
});
