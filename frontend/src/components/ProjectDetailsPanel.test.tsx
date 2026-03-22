import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { ProjectDetailsPanel } from './ProjectDetailsPanel';
import type { Project } from '@/lib/types';
import * as api from '@/lib/api';
import * as builderforceApi from '@/lib/builderforceApi';

vi.mock('@/lib/api');
vi.mock('@/lib/builderforceApi');

const sample: Project = {
  id: 1,
  name: 'Test Project',
  description: 'original description',
  key: 'OLDKEY',
  status: 'active',
  created_at: new Date().toISOString(),
};

describe('ProjectDetailsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    vi.spyOn(builderforceApi, 'checkProjectKeyAvailable').mockResolvedValue({ available: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows inline editing of name, description, key and status', async () => {
    const updateSpy = vi.spyOn(api, 'updateProject').mockResolvedValue({
      ...sample,
      name: 'New name',
      description: 'new description',
      key: 'NEWKEY',
      status: 'archived',
    });
    const onProjectUpdate = vi.fn();
    const { getByLabelText, getByText, queryByText } = render(
      <ProjectDetailsPanel
        project={sample}
        open={true}
        onClose={() => {}}
        onProjectUpdate={onProjectUpdate}
      />
    );

    // click edit icon in overview card
    const editBtn = getByLabelText('Edit project');
    fireEvent.click(editBtn);

    // inputs should appear
    const nameInput = getByLabelText('Name');
    const keyInput = getByLabelText('Project key');
    const statusSelect = getByLabelText('Status');
    const descArea = getByLabelText('Description');

    fireEvent.change(nameInput, { target: { value: 'New name' } });
    fireEvent.change(keyInput, { target: { value: 'newkey' } });
    fireEvent.change(statusSelect, { target: { value: 'archived' } });
    fireEvent.change(descArea, { target: { value: 'new description' } });

    // advance past the 500ms key-check debounce so keyStatus becomes 'available'
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // submit form
    const saveBtn = getByText('Save');
    fireEvent.click(saveBtn);

    await act(async () => {
      await Promise.resolve();
    });

    expect(updateSpy).toHaveBeenCalled();

    expect(onProjectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New name',
      key: 'NEWKEY',
      status: 'archived',
    }));

    // after save editing mode should exit
    expect(queryByText('Save')).toBeNull();
  });
});
