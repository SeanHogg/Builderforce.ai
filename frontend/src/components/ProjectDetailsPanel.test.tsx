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
    vi.spyOn(builderforceApi, 'checkProjectKeyAvailable').mockImplementation(async (key) => ({ available: true, key }));
    // The panel embeds the PMO initiative picker, which loads the PMO tree on mount
    // via pmoApi.tree(); give the automocked call a resolved (empty) tree so
    // usePmData's loader resolves instead of crashing on `undefined.then`.
    vi.spyOn(builderforceApi.pmoApi, 'tree').mockResolvedValue({ portfolios: [], initiatives: [], projects: [], dependencies: [] });
    // The panel also embeds ProjectInspectionReport, which best-effort loads the
    // saved diagnostic maturity via toolsApi.projectScore() on mount. Give the
    // automocked call a resolved value so the effect's `.then` doesn't crash on
    // `undefined.then`; null mirrors the "no runs yet / non-manager" path.
    vi.spyOn(builderforceApi.toolsApi, 'projectScore').mockResolvedValue(null as never);
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

    // click edit icon in overview card. The panel is localized via next-intl;
    // the test mock makes `t('key')` a passthrough returning `projectDetails.<key>`,
    // so we query by those keys rather than translated English copy.
    const editBtn = getByLabelText('projectDetails.editAria');
    fireEvent.click(editBtn);

    // inputs should appear
    const nameInput = getByLabelText('projectDetails.nameLabel');
    const keyInput = getByLabelText('projectDetails.keyLabel');
    const statusSelect = getByLabelText('projectDetails.statusLabel');
    const descArea = getByLabelText('projectDetails.descriptionLabel');

    fireEvent.change(nameInput, { target: { value: 'New name' } });
    fireEvent.change(keyInput, { target: { value: 'newkey' } });
    fireEvent.change(statusSelect, { target: { value: 'archived' } });
    fireEvent.change(descArea, { target: { value: 'new description' } });

    // advance past the 500ms key-check debounce so keyStatus becomes 'available'
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // submit form
    const saveBtn = getByText('projectDetails.save');
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
    expect(queryByText('projectDetails.save')).toBeNull();
  });
});
