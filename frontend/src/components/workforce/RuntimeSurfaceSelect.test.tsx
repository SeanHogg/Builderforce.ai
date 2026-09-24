import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { RuntimeSurfaceSelect, useRuntimeSurfaceBlocked, useRuntimeSurfaceRefusal } from './RuntimeSurfaceSelect';
import { reposApi, type GithubActionsStatus } from '@/lib/builderforceApi';
import { invalidateClientCache } from '@/infrastructure/http/readThrough';
import * as scope from '@/lib/ProjectScopeContext';

/**
 * The container surface is gated on the PLAN, not on the project, and the answer rides
 * on the shared consumption snapshot. Mocked at the hook rather than at the endpoint so
 * a test can state the entitlement directly — including the `null` "not known yet",
 * which is the case the component must not lock on.
 */
const snapshot = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/useConsumption', () => ({
  useConsumption: () => snapshot.current,
  fetchConsumptionSnapshot: async () => snapshot.current,
  invalidateConsumption: () => {},
}));
function entitledToContainers(value: boolean | null) {
  snapshot.current = value == null ? null : { features: { entitled: { containerRuntime: value } } };
}

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

describe('RuntimeSurfaceSelect — the container surface is a PLAN gate', () => {
  beforeEach(() => { inProject(4); freshReadiness(); entitledToContainers(null); });
  afterEach(() => { vi.restoreAllMocks(); freshReadiness(); entitledToContainers(null); });

  it('offers AUTOMATIC first — an unset surface is resolved per plan by the server', async () => {
    // The form used to hard-code 'durable', which pinned every agent created in the UI to
    // the shell-less surface forever — including on a workspace entitled to a container,
    // and including after an upgrade. Automatic is the absence of that choice.
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status({ ready: true }));
    const { findByRole, findAllByRole } = render(<RuntimeSurfaceSelect value="" onChange={() => {}} />);
    const options = await openOptions(findByRole, findAllByRole);
    expect(options[0]?.textContent).toContain('cloudAgentForm.surfaceLabel.auto');
    expect(options[0]?.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('disables the container option for a workspace whose plan does not cover it', async () => {
    // A container is billable Cloudflare compute held open for the length of a run. A free
    // workspace runs on the free (durable) infrastructure, and the server DEMOTES an
    // explicit container anyway — so offering it here would be the same after-the-fact
    // degrade this component exists to stop.
    entitledToContainers(false);
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status({ ready: true }));
    const { findByRole, findAllByRole } = render(<RuntimeSurfaceSelect value="" onChange={() => {}} />);
    const option = optionFor(await openOptions(findByRole, findAllByRole), 'container');
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.textContent).toContain('cloudAgentForm.surfaceUnavailableOption');
    expect(await findByRole('status')).toHaveTextContent('cloudAgentForm.surfaceContainerLocked');
  });

  it('leaves it selectable for an entitled workspace', async () => {
    entitledToContainers(true);
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status({ ready: true }));
    const { findByRole, findAllByRole, queryByRole } = render(<RuntimeSurfaceSelect value="" onChange={() => {}} />);
    const option = optionFor(await openOptions(findByRole, findAllByRole), 'container');
    expect(option.getAttribute('aria-disabled')).not.toBe('true');
    await waitFor(() => expect(queryByRole('status')).toBeNull());
  });

  it('UNKNOWN IS NOT NO — no snapshot yet must not lock the option', async () => {
    // Same rule as the Actions readiness: a slow or failed consumption read would
    // otherwise make a configuration the workspace pays for unreachable.
    entitledToContainers(null);
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status({ ready: true }));
    const { findByRole, findAllByRole } = render(<RuntimeSurfaceSelect value="" onChange={() => {}} />);
    const option = optionFor(await openOptions(findByRole, findAllByRole), 'container');
    expect(option.getAttribute('aria-disabled')).not.toBe('true');
  });
});

describe('useRuntimeSurfaceRefusal — WHICH refusal, not just whether', () => {
  beforeEach(() => { inProject(4); freshReadiness(); entitledToContainers(null); });
  afterEach(() => { vi.restoreAllMocks(); freshReadiness(); entitledToContainers(null); });

  function Probe({ surface }: { surface: string }) {
    return <span data-testid="why">{String(useRuntimeSurfaceRefusal(surface))}</span>;
  }

  it('names the PLAN for a container and the PROJECT for Actions', async () => {
    // Both submit paths used to rebuild this sentence from the surface key, which forced
    // one generic "not available for this project" wording onto a plan refusal — telling
    // a free workspace to go fix its repo.
    entitledToContainers(false);
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status());
    const { findByTestId, unmount } = render(<Probe surface="container" />);
    expect(await findByTestId('why')).toHaveTextContent('cloudAgentForm.errSurfaceBlockedPlan');
    unmount();
    const second = render(<Probe surface="github_actions" />);
    await waitFor(async () => expect(await second.findByTestId('why')).toHaveTextContent('cloudAgentForm.errSurfaceBlocked'));
  });

  it('is null for Automatic and for an entitled container — nothing to refuse', async () => {
    entitledToContainers(true);
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status({ ready: true }));
    const { findByTestId, unmount } = render(<Probe surface="" />);
    expect(await findByTestId('why')).toHaveTextContent('null');
    unmount();
    const second = render(<Probe surface="container" />);
    expect(await second.findByTestId('why')).toHaveTextContent('null');
  });

  it('still answers the boolean form for a disabled state with no copy', async () => {
    entitledToContainers(false);
    vi.spyOn(reposApi, 'githubActionsStatus').mockResolvedValue(status({ ready: true }));
    function Bool() { return <span data-testid="blocked">{String(useRuntimeSurfaceBlocked('container'))}</span>; }
    const { findByTestId } = render(<Bool />);
    expect(await findByTestId('blocked')).toHaveTextContent('true');
  });
});
