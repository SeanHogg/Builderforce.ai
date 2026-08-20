import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { RuntimeSurfaceSelect, useRuntimeSurfaceBlocked } from './RuntimeSurfaceSelect';
import { reposApi, type GithubActionsStatus } from '@/lib/builderforceApi';
import { invalidateClientCache } from '@/infrastructure/http/readThrough';
import * as scope from '@/lib/ProjectScopeContext';

import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

/**
 * The picker exists to stop a user choosing the GitHub Actions surface for a
 * project that cannot run it. Warning underneath was the previous behaviour and
 * was not enough: the form could still be submitted, dispatch quietly degraded to
 * the durable executor, and it only said so in the run timeline afterwards.
 *
 * Two properties matter here, and they pull in opposite directions:
 *
 *   • the option is DISABLED on a provable "not ready", and
 *   • UNKNOWN IS NOT NO — no project in scope, a failed read or a read still in
 *     flight must leave every option selectable, or an unrelated bad minute on
 *     one endpoint makes a perfectly good configuration unreachable.
 *
 * Copy is the passthrough key under the global next-intl mock (src/test/setup.ts).
 *
 * `<Select>` is our own themed combobox, not a native `<select>`: the options are
 * portaled and only exist in the DOM once the popup is open. So every assertion
 * about an option OPENS the popup first and reads `role="option"` / `aria-disabled`,
 * which is also exactly what a screen reader sees.
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

/** The readiness read is served through the shared client cache, so one test's
 *  answer would otherwise be the next test's answer. */
function freshReadiness() {
  invalidateClientCache('gh-actions-readiness');
}

/** Open the portaled listbox and return its options, keyed by surface label text. */
async function openOptions(
  findByRole: (role: string) => Promise<HTMLElement>,
  findAllByRole: (role: string) => Promise<HTMLElement[]>,
): Promise<HTMLElement[]> {
  fireEvent.click(await findByRole('combobox'));
  return findAllByRole('option');
}

/** The one option whose label names `surface` — the disabled one wears a wrapper
 *  key, so match on the surface label rather than on equality. */
function optionFor(options: HTMLElement[], surface: string): HTMLElement {
  const found = options.find((o) => (o.textContent ?? '').includes(`cloudAgentForm.surfaceLabel.${surface}`));
  if (!found) throw new Error(`no option for ${surface} in: ${options.map((o) => o.textContent).join(' | ')}`);
  return found;
}

describe('RuntimeSurfaceSelect', () => {
  beforeEach(() => { inProject(4); freshReadiness(); });
  afterEach(() => { vi.restoreAllMocks(); freshReadiness(); });

  it('disables GitHub Actions when the default repo has no agent workflow', async () => {
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status());
    const { findByRole, findAllByRole } = render(<RuntimeSurfaceSelect value="durable" onChange={() => {}} />);
    // The reason renders as a live region as soon as the answer is a hard "no".
    expect(await findByRole('status')).toHaveTextContent('githubActionsSurface.notReadyTitle');
    const option = optionFor(await openOptions(findByRole, findAllByRole), 'github_actions');
    expect(option.getAttribute('aria-disabled')).toBe('true');
    // The short reason must ride in the option TEXT — a screen reader announces
    // the option, never the prose beside the select.
    expect(option.textContent).toContain('cloudAgentForm.surfaceUnavailableOption');
  });

  it('distinguishes "no GitHub repo at all" from "workflow missing"', async () => {
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status({ repositories: [] }));
    const { findByRole } = render(<RuntimeSurfaceSelect value="durable" onChange={() => {}} />);
    expect(await findByRole('status')).toHaveTextContent('githubActionsSurface.noGithubRepoBody');
  });

  it('says nothing and disables nothing once the surface is actually ready', async () => {
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status({ ready: true }));
    const { findByRole, findAllByRole, queryByRole } = render(<RuntimeSurfaceSelect value="durable" onChange={() => {}} />);
    await waitFor(() => expect(queryByRole('status')).toBeNull());
    const option = optionFor(await openOptions(findByRole, findAllByRole), 'github_actions');
    expect(option.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('never disables the unconditional surfaces', async () => {
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status());
    const { findByRole, findAllByRole } = render(<RuntimeSurfaceSelect value="durable" onChange={() => {}} />);
    await findByRole('status');
    const options = await openOptions(findByRole, findAllByRole);
    for (const rs of ['durable', 'container']) {
      expect(optionFor(options, rs).getAttribute('aria-disabled'), rs).not.toBe('true');
    }
  });

  it('stays silent when the readiness read fails — unknown is not "broken"', async () => {
    vi.spyOn(reposApi, 'githubActionsStatus').mockRejectedValue(new Error('offline'));
    const { findByRole, findAllByRole, queryByRole } = render(<RuntimeSurfaceSelect value="durable" onChange={() => {}} />);
    await waitFor(() => expect(queryByRole('status')).toBeNull());
    const option = optionFor(await openOptions(findByRole, findAllByRole), 'github_actions');
    expect(option.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('stays silent with no project in scope — there is nothing to be ready', async () => {
    inProject(null);
    const read = vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status());
    const { queryByRole } = render(<RuntimeSurfaceSelect value="durable" onChange={() => {}} />);
    await waitFor(() => expect(queryByRole('status')).toBeNull());
    expect(read).not.toHaveBeenCalled();
  });
});

describe('useRuntimeSurfaceBlocked', () => {
  beforeEach(() => { inProject(4); freshReadiness(); });
  afterEach(() => { vi.restoreAllMocks(); freshReadiness(); });

  /** A submit guard has to read the same fact the picker rendered; the hook is
   *  exercised through a probe rather than a renderHook helper the suite lacks. */
  function Probe({ surface }: { surface: string }) {
    return <span data-testid="blocked">{String(useRuntimeSurfaceBlocked(surface))}</span>;
  }

  it('blocks a save on the surface the picker disabled', async () => {
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status());
    const { findByTestId } = render(<Probe surface="github_actions" />);
    await waitFor(async () => expect(await findByTestId('blocked')).toHaveTextContent('true'));
  });

  it('never blocks an unconditional surface, whatever readiness says', async () => {
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status());
    const { findByTestId } = render(<Probe surface="durable" />);
    expect(await findByTestId('blocked')).toHaveTextContent('false');
  });
});

describe('localization', () => {
  // Every string these two features render must exist in all five catalogs — a
  // missing key renders the raw key to the user in that locale.
  const catalogs = { en, zh, es, fr, de } as unknown as Record<string, Record<string, Record<string, string>>>;
  const required: Record<string, string[]> = {
    githubActionsSurface: ['notReadyTitle', 'notReadyBody', 'noGithubRepoBody'],
    // The disabled option's own label — the only reason a screen-reader user gets.
    cloudAgentForm: ['surface', 'surfaceHelp', 'surfaceUnavailableOption'],
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
