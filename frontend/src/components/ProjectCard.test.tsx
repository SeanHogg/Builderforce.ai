import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { ProjectCard } from './ProjectCard';
import type { Project } from '@/lib/types';
import * as api from '@/lib/api';
import * as builderforceApi from '@/lib/builderforceApi';

vi.mock('@/lib/api');
vi.mock('@/lib/builderforceApi');
// Some card children navigate via next/navigation; stub the router.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const sample: Project = {
  id: 1,
  name: 'Test',
  description: 'desc',
  created_at: new Date().toISOString(),
};

describe('ProjectCard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // DeleteProjectDialog loads the board's open tasks + destination boards on open.
    vi.spyOn(builderforceApi.tasksApi, 'list').mockResolvedValue([]);
    vi.spyOn(api, 'fetchProjects').mockResolvedValue([]);
  });

  it('renders basic info and fires onDelete after confirmation', async () => {
    const onDelete = vi.fn();
    const { getByLabelText, queryByText, getByText, findByText } = render(
      <ProjectCard project={sample} onDelete={onDelete} showDeleteButton />
    );

    // delete button should be in document (label resolves to the i18n key under the
    // test's next-intl passthrough mock — see src/test/setup.ts)
    const button = getByLabelText('projectCard.deleteProject');
    fireEvent.click(button);

    // confirm dialog should appear
    expect(getByText(/Delete project "Test"\?/)).toBeTruthy();

    // once the (empty) task check resolves, the confirm button enables
    const confirmBtn = await findByText('Delete');
    await waitFor(() => expect((confirmBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirmBtn);

    expect(onDelete).toHaveBeenCalledWith(sample);
    // dialog should disappear
    expect(queryByText(/Delete project "Test"\?/)).toBeNull();
  });

  it('shows details icon and calls onDetailsClick', () => {
    const onDetails = vi.fn();
    const { getByLabelText } = render(
      <ProjectCard project={sample} onDetailsClick={onDetails} showDetailsButton />
    );
    const btn = getByLabelText('projectCard.details');
    fireEvent.click(btn);
    expect(onDetails).toHaveBeenCalledWith(sample);
  });
});
