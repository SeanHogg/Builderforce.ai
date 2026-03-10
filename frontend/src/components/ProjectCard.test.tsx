import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ProjectCard } from './ProjectCard';
import type { Project } from '@/lib/types';

const sample: Project = {
  id: 1,
  name: 'Test',
  description: 'desc',
  created_at: new Date().toISOString(),
};

describe('ProjectCard', () => {
  it('renders basic info and fires onDelete after confirmation', async () => {
    const onDelete = vi.fn();
    const { getByLabelText, queryByText, getByText } = render(
      <ProjectCard project={sample} onDelete={onDelete} showDeleteButton />
    );

    // delete button should be in document
    const button = getByLabelText('Delete project');
    fireEvent.click(button);

    // confirm dialog should appear
    expect(getByText(/Delete project "Test"\?/)).toBeTruthy();

    // click confirm
    const confirmBtn = getByText('Delete');
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
    const btn = getByLabelText('Details');
    fireEvent.click(btn);
    expect(onDetails).toHaveBeenCalledWith(sample);
  });
});
