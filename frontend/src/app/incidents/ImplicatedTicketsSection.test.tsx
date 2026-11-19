import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { incidentsApi } from '@/lib/builderforceApi';
import { ImplicatedTicketsSection } from './ImplicatedTicketsSection';

// The global next-intl mock returns keys, so these assert WIRING: rows load, the add input is
// labelled, link/unlink call the API and reload, and a failed read degrades to the empty state.

const t = ((key: string) => key) as unknown as Parameters<typeof ImplicatedTicketsSection>[0]['t'];

const row = {
  taskId: 5, title: 'Broken deploy', status: 'in_progress',
  accountability: { percentComplete: 50, completedCount: 1, requiredCount: 2, gaps: [{ roleName: 'QA' }] },
};

afterEach(() => { vi.restoreAllMocks(); });

describe('ImplicatedTicketsSection', () => {
  it('renders implicated tickets with their accountability gaps', async () => {
    vi.spyOn(incidentsApi, 'implicated').mockResolvedValue([row] as never);
    render(<ImplicatedTicketsSection t={t} canManage={false} incidentId="i1" />);
    expect(await screen.findByText(/Broken deploy/)).toBeTruthy();
    expect(screen.getByText(/QA/)).toBeTruthy();
    expect(screen.queryByLabelText('implicated.addPlaceholder')).toBeNull();
  });

  it('shows the empty state when the read fails', async () => {
    vi.spyOn(incidentsApi, 'implicated').mockRejectedValue(new Error('boom'));
    render(<ImplicatedTicketsSection t={t} canManage incidentId="i1" />);
    expect(await screen.findByText('implicated.empty')).toBeTruthy();
  });

  it('links a ticket through the labelled input and reloads', async () => {
    const read = vi.spyOn(incidentsApi, 'implicated').mockResolvedValue([] as never);
    const link = vi.spyOn(incidentsApi, 'linkImplicated').mockResolvedValue(undefined as never);
    render(<ImplicatedTicketsSection t={t} canManage incidentId="i1" />);
    await screen.findByText('implicated.empty');
    fireEvent.change(screen.getByLabelText('implicated.addPlaceholder'), { target: { value: '42' } });
    fireEvent.click(screen.getByText('implicated.add'));
    await waitFor(() => expect(link).toHaveBeenCalledWith('i1', { taskId: 42 }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('unlinks a ticket and reloads', async () => {
    const read = vi.spyOn(incidentsApi, 'implicated').mockResolvedValue([row] as never);
    const unlink = vi.spyOn(incidentsApi, 'unlinkImplicated').mockResolvedValue(undefined as never);
    render(<ImplicatedTicketsSection t={t} canManage incidentId="i1" />);
    fireEvent.click(await screen.findByText('implicated.remove'));
    await waitFor(() => expect(unlink).toHaveBeenCalledWith('i1', 5));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });
});
