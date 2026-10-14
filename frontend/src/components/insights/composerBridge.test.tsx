import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { replayApi } from '@/lib/replayApi';
import { prescription } from '@/test/replayPrescriptionFixtures';
import { PrescriptionCard } from '@/components/replay/prescriptions/PrescriptionCard';
import { clearPreviewPicks, getPreviewPicks, previewPicksContext } from '@/lib/workspace/previewPick';
import { ComposerBridgeProvider, INSIGHTS_PICK_OWNER, composerBridgeFor, composerTargets, type ComposerBridge } from './composerBridge';

/**
 * "Apply in composer" (PRD 33 §5.1.4, §5.2) exists only where the host has THE ONE
 * composer (the canvas provides the bridge): elsewhere the card does not draw it;
 * inside, it runs the API action and hands the API's prompt as the draft and every
 * element it changes as a chip — a selector-anchored pick of THE pick seam.
 */

vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));

const RX = prescription({ next: ['apply-in-composer', 'copy-prompt', 'dismiss'] });
const button = (action: string) => document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);

beforeEach(() => {
  vi.spyOn(replayApi, 'actOnPrescription').mockResolvedValue({
    prescription: prescription({ status: 'applied', actionKind: 'apply_in_composer', next: ['copy-prompt', 'dismiss'] }),
    prompt: 'Improve this page of the app on the canvas.',
    selectors: ['button.buy', '#hero h1'],
    targets: [{ selector: 'button.buy', label: 'Buy now' }, { selector: '#hero h1', label: 'Plans for everyone' }],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  clearPreviewPicks();
});

describe('composer bridge', () => {
  it('hides Apply in composer without a bridge', () => {
    render(<PrescriptionCard siteId="site-1" prescription={RX} />);
    expect(button('apply-in-composer')).toBeNull();
    expect(button('copy-prompt')).not.toBeNull();
  });

  it('with a bridge, runs the action and hands its prompt and labelled targets to the composer', async () => {
    const bridge: ComposerBridge = { applyToComposer: vi.fn() };
    render(
      <ComposerBridgeProvider value={bridge}>
        <PrescriptionCard siteId="site-1" prescription={RX} />
      </ComposerBridgeProvider>,
    );
    fireEvent.click(button('apply-in-composer')!);
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenCalledWith('site-1', 'rx-1', 'apply-in-composer', {}));
    expect(bridge.applyToComposer).toHaveBeenCalledWith({
      prompt: 'Improve this page of the app on the canvas.',
      targets: [{ selector: 'button.buy', label: 'Buy now' }, { selector: '#hero h1', label: 'Plans for everyone' }],
      pagePath: RX.pagePath ?? '/',
    });
    expect(await screen.findByText('replay.prescription.result.composer')).toBeInTheDocument();
  });

  it('the canvas bridge sets the draft AND pushes one selector chip per targeted element', () => {
    const composeDraft = vi.fn();
    const bridge = composerBridgeFor(composeDraft, 'Phone plans');
    bridge.applyToComposer({
      prompt: 'Make the hero clearer.',
      targets: [{ selector: 'button.buy', label: 'Buy now' }, { selector: '#hero h1', label: '' }],
      pagePath: '/pricing',
    });
    expect(composeDraft).toHaveBeenCalledWith('Make the hero clearer.');
    const picks = getPreviewPicks();
    expect(picks.map((p) => p.anchor)).toEqual([
      { kind: 'selector', selector: 'button.buy', label: 'Buy now', pagePath: '/pricing' },
      { kind: 'selector', selector: '#hero h1', label: '', pagePath: '/pricing' },
    ]);
    expect(picks.every((p) => p.owner === INSIGHTS_PICK_OWNER)).toBe(true);
    // The turn the person sends names each element by label and selector on its page.
    expect(previewPicksContext(picks)).toContain('element `Buy now` (`button.buy`) on `/pricing`');

    // A second apply replaces the first fix's chips rather than piling onto them.
    bridge.applyToComposer({ prompt: 'Next fix.', targets: [{ selector: '#cta', label: 'Start' }], pagePath: '/' });
    expect(getPreviewPicks().map((p) => p.anchor)).toEqual([{ kind: 'selector', selector: '#cta', label: 'Start', pagePath: '/' }]);
  });

  it('an answer without labels still yields one chip per selector', () => {
    expect(composerTargets({ selectors: ['a.x', 'b.y'] })).toEqual([{ selector: 'a.x', label: '' }, { selector: 'b.y', label: '' }]);
    expect(composerTargets({ selectors: ['a.x'], targets: [{ selector: 'a.x', label: 'X' }] })).toEqual([{ selector: 'a.x', label: 'X' }]);
  });
});
