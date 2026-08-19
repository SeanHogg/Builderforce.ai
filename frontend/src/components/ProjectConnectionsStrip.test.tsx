import { describe, it, expect, vi } from 'vitest';
import { render, within } from '@testing-library/react';
import { ProjectConnectionsStrip } from './ProjectConnectionsStrip';
import type { ProjectConnection } from '@/lib/projectConnections';

// Visible strings resolve to their i18n key under the passthrough next-intl mock
// (src/test/setup.ts), so these assert on the key, not on English.
const CONN = (over: Partial<ProjectConnection> = {}): ProjectConnection => ({
  kind: 'source_control',
  provider: 'github',
  label: 'acme/site',
  url: 'https://github.com/acme/site',
  health: 'ok',
  reason: null,
  isDefault: true,
  openPullRequests: 0,
  openPullRequestsRecordedOnly: false,
  buildStatus: null,
  buildUrl: null,
  buildBranch: null,
  buildAt: null,
  buildProbedAt: null,
  lastSyncedAt: null,
  ...over,
});

describe('ProjectConnectionsStrip', () => {
  it('renders nothing for a project with no connections', () => {
    expect(render(<ProjectConnectionsStrip connections={[]} />).container.firstChild).toBeNull();
    expect(render(<ProjectConnectionsStrip connections={undefined} />).container.firstChild).toBeNull();
  });

  it('links the repo chip at the repo and the build chip at its run', () => {
    const { getByText, getByRole } = render(
      <ProjectConnectionsStrip
        connections={[CONN({ buildStatus: 'failure', buildUrl: 'https://gh/run/9', buildBranch: 'main' })]}
      />,
    );
    expect(getByText('acme/site').closest('a')?.getAttribute('href')).toBe('https://github.com/acme/site');
    expect(getByRole('link', { name: /projectConnections\.buildAria/ }).getAttribute('href')).toBe('https://gh/run/9');
    expect(getByText('projectConnections.build.failure')).toBeTruthy();
  });

  it('sends open PRs to the provider-correct listing path', () => {
    // Both renders share one document body, so scope each query to its own container.
    const github = render(<ProjectConnectionsStrip connections={[CONN({ openPullRequests: 3 })]} />);
    expect(within(github.container).getByRole('link', { name: /openPrs/ }).getAttribute('href'))
      .toBe('https://github.com/acme/site/pulls');

    const bitbucket = render(
      <ProjectConnectionsStrip
        connections={[CONN({ provider: 'bitbucket', url: 'https://bitbucket.org/acme/site', openPullRequests: 3 })]}
      />,
    );
    expect(within(bitbucket.container).getByRole('link', { name: /openPrs/ }).getAttribute('href'))
      .toBe('https://bitbucket.org/acme/site/pull-requests');
  });

  it('hides the PR chip when there is nothing open', () => {
    const { queryByText } = render(<ProjectConnectionsStrip connections={[CONN({ openPullRequests: 0 })]} />);
    expect(queryByText(/openPrs/)).toBeNull();
  });

  it('states the failure reason instead of a bare health word', () => {
    const { getByLabelText } = render(
      <ProjectConnectionsStrip connections={[CONN({ health: 'error', reason: 'unauthorized' })]} />,
    );
    // connectionAria interpolates the reason, so the chip announces WHY it is red.
    expect(getByLabelText(/projectConnections\.reason\.unauthorized/)).toBeTruthy();
  });

  it('routes a board (which has no external URL) to the Integrations tab', () => {
    const onManage = vi.fn();
    const { getByText } = render(
      <ProjectConnectionsStrip
        connections={[CONN({ kind: 'board', provider: 'jira', label: 'ENG', url: null, openPullRequests: null })]}
        onManage={onManage}
      />,
    );
    getByText('ENG').closest('button')?.click();
    expect(onManage).toHaveBeenCalled();
  });

  it('collapses past the cap into a single overflow chip', () => {
    const { getByText, queryByText } = render(
      <ProjectConnectionsStrip
        connections={[CONN({ label: 'a/one' }), CONN({ label: 'a/two' }), CONN({ label: 'a/three' })]}
        max={2}
      />,
    );
    expect(getByText('a/one')).toBeTruthy();
    expect(queryByText('a/three')).toBeNull();
    // The passthrough t() renders "<key> <values…>", so match the key, not exact text.
    expect(getByText(/projectConnections\.more/)).toBeTruthy();
  });
});
