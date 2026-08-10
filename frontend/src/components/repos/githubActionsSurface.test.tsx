import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { GithubActionsSurfaceNotice } from './githubActionsSurface';
import { reposApi, type GithubActionsStatus } from '@/lib/builderforceApi';
import * as scope from '@/lib/ProjectScopeContext';

import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

/**
 * The notice exists to stop a user picking the GitHub Actions surface for a
 * project that cannot run it — previously that choice silently degraded to the
 * durable executor and only explained itself in the run timeline afterwards.
 *
 * The interesting property is restraint. It must warn ONLY on a positive "not
 * enabled" answer: warning while the readiness read is still in flight, or when
 * it failed, or when no project is in scope, would train users to ignore it.
 *
 * Copy is the passthrough key under the global next-intl mock (src/test/setup.ts).
 */
function status(over: Partial<GithubActionsStatus> = {}): GithubActionsStatus {
  return {
    ready: false,
    workflowPath: '.github/workflows/builderforce-agent.yml',
    repositories: [{ repoId: 'r1', supported: true, enabled: false, isDefault: true }],
    ...over,
  };
}

function inProject(id: number | null) {
  vi.spyOn(scope, 'useOptionalProjectScope').mockReturnValue(
    id == null ? null : ({ currentProjectId: id } as ReturnType<typeof scope.useOptionalProjectScope>),
  );
}

describe('GithubActionsSurfaceNotice', () => {
  beforeEach(() => { inProject(4); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('warns when GitHub Actions is selected but the default repo has no agent workflow', async () => {
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status());
    const { findByRole } = render(<GithubActionsSurfaceNotice surface="github_actions" />);
    expect(await findByRole('status')).toHaveTextContent('githubActionsSurface.notReadyTitle');
  });

  it('distinguishes "no GitHub repo at all" from "workflow missing"', async () => {
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status({ repositories: [] }));
    const { findByRole } = render(<GithubActionsSurfaceNotice surface="github_actions" />);
    expect(await findByRole('status')).toHaveTextContent('githubActionsSurface.noGithubRepoBody');
  });

  it('says nothing once the surface is actually ready', async () => {
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status({ ready: true }));
    const { queryByRole } = render(<GithubActionsSurfaceNotice surface="github_actions" />);
    await waitFor(() => expect(queryByRole('status')).toBeNull());
  });

  it('says nothing for the other surfaces, and does not even ask', () => {
    const read = vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status());
    for (const surface of ['durable', 'container']) {
      const { queryByRole } = render(<GithubActionsSurfaceNotice surface={surface} />);
      expect(queryByRole('status'), surface).toBeNull();
    }
    expect(read).toHaveBeenCalledTimes(2); // one readiness read per mount, no warning rendered
  });

  it('stays silent when the readiness read fails — unknown is not "broken"', async () => {
    vi.spyOn(reposApi, 'githubActionsStatus').mockRejectedValue(new Error('offline'));
    const { queryByRole } = render(<GithubActionsSurfaceNotice surface="github_actions" />);
    await waitFor(() => expect(queryByRole('status')).toBeNull());
  });

  it('stays silent with no project in scope — there is nothing to be ready', async () => {
    inProject(null);
    const read = vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status());
    const { queryByRole } = render(<GithubActionsSurfaceNotice surface="github_actions" />);
    await waitFor(() => expect(queryByRole('status')).toBeNull());
    expect(read).not.toHaveBeenCalled();
  });
});

describe('localization', () => {
  // Every string these two features render must exist in all five catalogs — a
  // missing key renders the raw key to the user in that locale.
  const catalogs = { en, zh, es, fr, de } as unknown as Record<string, Record<string, Record<string, string>>>;
  const required: Record<string, string[]> = {
    githubActionsSurface: ['notReadyTitle', 'notReadyBody', 'noGithubRepoBody'],
    sourceControl: [
      'enableAgentRuns', 'agentRunsEnabled', 'enablingAgentRuns', 'enableAgentRunsTitle',
      'reenableAgentRunsTitle', 'confirmReenableActions', 'actionsEnabled', 'actionsEnableFailed',
      'backfillAlerts', 'backfillingAlerts', 'backfillAlertsTitle', 'alertsBackfilled', 'alertsBackfillFailed',
    ],
  };

  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`${locale} carries every new key, translated`, () => {
      for (const [group, keys] of Object.entries(required)) {
        for (const key of keys) {
          const value = catalog[group]?.[key];
          expect(value, `${locale}.${group}.${key}`).toBeTruthy();
          // A catalog that merely copied the English string is not localized.
          if (locale !== 'en') expect(value, `${locale}.${group}.${key}`).not.toBe(catalogs.en[group]![key]);
        }
      }
    });
  }
});
