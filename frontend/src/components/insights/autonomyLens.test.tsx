import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { AutonomyLens } from './AutonomyLens';
import { autonomyApi, type AutonomyOriginStats, type AutonomySummary, type TicketOrigin } from '@/lib/autonomyApi';
import * as scope from '@/lib/ProjectScopeContext';

import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

/**
 * Autonomy Health lens.
 *
 * The lens exists to answer ONE question honestly: do the tickets the AI manager
 * opens actually finish themselves, or does a person move every card? So the
 * properties worth locking down are the ones a cosmetic refactor could quietly
 * break:
 *   • the funnel is rendered PER ORIGIN — the manager/agent vs human comparison IS
 *     the deliverable, so a single merged funnel would be a regression;
 *   • the read is scoped by the GLOBAL project scope, not a bespoke picker;
 *   • a TRUNCATED audit says so — reporting a sample as full coverage is the one
 *     dishonesty this surface must never commit.
 *
 * Copy is the passthrough key under the global next-intl mock (src/test/setup.ts).
 */

function stats(origin: TicketOrigin, over: Partial<AutonomyOriginStats> = {}): AutonomyOriginStats {
  return {
    origin,
    tickets: 10, everDispatched: 8, progressedAutonomously: 6, reachedTerminal: 4, fullyAutonomous: 2,
    stalled: 3, neverStarted: 1, autonomousHops: 12, humanHops: 4,
    ...over,
  };
}

function summary(over: Partial<AutonomySummary> = {}): AutonomySummary {
  const agent = stats('agent', { tickets: 20, fullyAutonomous: 9, autonomousHops: 30, humanHops: 2 });
  const human = stats('human', { tickets: 10, fullyAutonomous: 1, autonomousHops: 3, humanHops: 14 });
  return {
    windowDays: 30,
    generatedAt: '2026-07-25T00:00:00.000Z',
    totals: stats('unknown', {
      tickets: 30, everDispatched: 22, progressedAutonomously: 18, reachedTerminal: 14, fullyAutonomous: 10,
      stalled: 6, neverStarted: 4, autonomousHops: 33, humanHops: 16,
    }),
    byOrigin: [agent, human],
    stallReasons: [
      { reason: 'no_agent', text: 'No run: the lane has no staffed agent.', tickets: 4 },
      { reason: 'human_gate', text: 'No run: this lane is human-gated.', tickets: 2 },
    ],
    truncated: false,
    ticketsScanned: 30,
    ...over,
  };
}

/** Put a project in (or out of) the global scope the lens reads. */
function inScope(id: number | null) {
  vi.spyOn(scope, 'useProjectScope').mockReturnValue({
    currentProjectId: id,
    currentProject: id == null ? null : { id, name: 'Apollo' },
  } as unknown as ReturnType<typeof scope.useProjectScope>);
}

describe('AutonomyLens', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('draws a funnel PER ORIGIN so manager/agent-created work can be compared with human-created', async () => {
    inScope(null);
    vi.spyOn(autonomyApi, 'get').mockResolvedValue(summary());
    const { container, findAllByText } = render(<AutonomyLens />);

    // Both origins get their own funnel panel (chip label), not one merged funnel.
    // (The label recurs across the funnel, the hop split, the donut legend and the
    // table — every view names the origin, so match all of them.)
    expect(await findAllByText('insights.autonomy.origin.agent')).not.toHaveLength(0);
    expect(await findAllByText('insights.autonomy.origin.human')).not.toHaveLength(0);

    // Every funnel stage is present, and the bars carry the share of created.
    const text = container.textContent ?? '';
    for (const stage of ['created', 'dispatched', 'progressed', 'terminal', 'fullyAutonomous']) {
      expect(text).toContain(`insights.autonomy.stage.${stage}`);
    }
    // The funnels are per origin, so the two end-to-end rates differ:
    // agent 9 of 20 → 45%; human 1 of 10 → 10%.
    expect(text).toContain('45%');
    expect(text).toContain('10%');
    // …and the mouth of every funnel is 100% of what that origin created.
    expect(text).toContain('100%');
  });

  it('splits lane moves into autonomous vs human and ranks the gates that hold the rest', async () => {
    inScope(null);
    vi.spyOn(autonomyApi, 'get').mockResolvedValue(summary());
    const { container } = render(<AutonomyLens />);

    await waitFor(() => expect(container.textContent).toContain('insights.autonomy.hopsAutonomous'));
    const text = container.textContent ?? '';
    expect(text).toContain('insights.autonomy.hopsHuman');
    // Stall gates reuse the board's existing localized triage vocabulary…
    expect(text).toContain('board.triage.reason.no_agent');
    expect(text).toContain('board.triage.reason.human_gate');
    // …and each is explained by its own localized sentence.
    expect(text).toContain('insights.autonomy.gate.no_agent');
  });

  it('says the figures are a SAMPLE when the server truncated the audit', async () => {
    inScope(2);
    vi.spyOn(autonomyApi, 'get').mockResolvedValue(summary({ truncated: true, ticketsScanned: 2000 }));
    const { findAllByRole } = render(<AutonomyLens />);

    // The caveat rides the header AND every card that quotes funnel figures — a
    // card can be pinned onto a dashboard away from this header, and a sample must
    // never read as full coverage there.
    const notes = await findAllByRole('note');
    expect(notes.length).toBeGreaterThan(1);
    for (const note of notes) {
      expect(note).toHaveTextContent('insights.autonomy.coverage.truncated');
      expect(note).not.toHaveTextContent('insights.autonomy.coverage.full');
    }
  });

  it('claims full coverage exactly once when the audit was complete', async () => {
    inScope(3);
    vi.spyOn(autonomyApi, 'get').mockResolvedValue(summary({ truncated: false, ticketsScanned: 30 }));
    const { findAllByRole } = render(<AutonomyLens />);

    const notes = await findAllByRole('note');
    expect(notes).toHaveLength(1); // the header line only — no per-card caveat
    expect(notes[0]).toHaveTextContent('insights.autonomy.coverage.full');
  });

  it('scopes the read to the globally selected project instead of a bespoke picker', async () => {
    inScope(7);
    const read = vi.spyOn(autonomyApi, 'get').mockResolvedValue(summary());
    const { container } = render(<AutonomyLens />);

    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(read).toHaveBeenCalledWith(30, 7);
    // …and the header names the scope rather than implying tenant-wide coverage.
    expect(container.textContent).toContain('insights.autonomy.scopeProject');
  });
});

describe('localization', () => {
  // Every string the lens renders must exist in all five catalogs — a missing key
  // renders the raw key to the user in that locale.
  const catalogs = { en, zh, es, fr, de } as unknown as Record<string, Record<string, unknown>>;
  const get = (root: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((at, k) => (at == null ? at : (at as Record<string, unknown>)[k]), root);

  const required = [
    'insights.autonomy.title', 'insights.autonomy.subtitle',
    'insights.autonomy.scopeAll', 'insights.autonomy.scopeProject',
    'insights.autonomy.coverage.full', 'insights.autonomy.coverage.truncated',
    'insights.autonomy.origin.label', 'insights.autonomy.origin.agent', 'insights.autonomy.origin.manager_card',
    'insights.autonomy.origin.human', 'insights.autonomy.origin.system', 'insights.autonomy.origin.unknown',
    'insights.autonomy.stage.created', 'insights.autonomy.stage.dispatched', 'insights.autonomy.stage.progressed',
    'insights.autonomy.stage.terminal', 'insights.autonomy.stage.fullyAutonomous',
    'insights.autonomy.allOrigins', 'insights.autonomy.conversion', 'insights.autonomy.ticketsCreated',
    'insights.autonomy.endToEnd', 'insights.autonomy.funnelAria', 'insights.autonomy.originMixAria',
    'insights.autonomy.hopsAutonomous', 'insights.autonomy.hopsHuman', 'insights.autonomy.hopsOfTotal',
    'insights.autonomy.hopSplitAria', 'insights.autonomy.stallAria',
    'insights.autonomy.noTickets', 'insights.autonomy.noHops', 'insights.autonomy.noStalls',
    'insights.autonomy.stat.fully', 'insights.autonomy.stat.fullySub', 'insights.autonomy.stat.dispatchedSub',
    'insights.autonomy.stat.hopShare', 'insights.autonomy.stat.hopShareSub',
    'insights.autonomy.stat.stalled', 'insights.autonomy.stat.stalledSub', 'insights.autonomy.stat.neverStartedSub',
    'insights.autonomy.gateShort.unrecorded',
    'insights.autonomy.gate.no_agent', 'insights.autonomy.gate.human_gate', 'insights.autonomy.gate.run_cap_exhausted',
    'insights.autonomy.gate.cooldown_active', 'insights.autonomy.gate.unrecorded',
    'insights.delivhub.panel.autonomy', 'insights.delivhub.panel.autonomyDesc',
    'components.group.autonomy',
    'components.title.autoFully', 'components.title.autoDispatched', 'components.title.autoHopShare',
    'components.title.autoStalled', 'components.title.autoNeverStarted', 'components.title.autoOriginFunnel',
    'components.title.autoHopSplit', 'components.title.autoStallGates', 'components.title.autoOriginMix',
    'components.title.autoFunnelTable', 'components.title.autoCoverage',
    'nav.tab.autonomy',
  ];

  /** Words that are legitimately spelled the same as English in some locales —
   *  "Agent" is the standard term in French and German, so an identical string
   *  there is a correct translation, not an untranslated copy. */
  const SAME_WORD_OK = new Set(['insights.autonomy.origin.agent']);

  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`${locale} carries every Autonomy key, translated`, () => {
      for (const key of required) {
        const value = get(catalog, key);
        expect(typeof value, `${locale}.${key}`).toBe('string');
        expect(value, `${locale}.${key}`).toBeTruthy();
        // A catalog that merely copied the English string is not localized.
        if (locale !== 'en' && !SAME_WORD_OK.has(key)) {
          expect(value, `${locale}.${key}`).not.toBe(get(catalogs.en, key));
        }
      }
    });
  }
});
