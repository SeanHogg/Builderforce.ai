/**
 * The bridge from an Insights fix to THE ONE composer (PRD 33 §5.1.4 "Apply in
 * composer", §5.2 "Prompt"). Only a host that HAS a composer provides it — the
 * canvas's Measure ▸ Visitors (`CanvasVisitorsSurface`) — so outside the canvas
 * there is no bridge and the `apply-in-composer` action is not drawn at all.
 *
 * `applyToComposer` puts the compiled `composer` prompt into the composer as a draft
 * and attaches every element the prompt changes as a removable chip — a
 * selector-anchored pick of THE pick seam (`lib/workspace/previewPick.ts`), so the
 * turn the person sends carries "element `<label>` (`<selector>`) on `<page>`" for
 * each. The person still presses send.
 */

import { createContext, useContext } from 'react';
import { setPreviewPicks, type PreviewPick } from '@/lib/workspace/previewPick';

/** One element a fix changes: its rect-map selector and label ('' for a masked region). */
export interface ComposerTarget {
  selector: string;
  label: string;
}

export interface ComposerDraft {
  prompt: string;
  targets: readonly ComposerTarget[];
  /** The page the targets are on. */
  pagePath: string;
}

export interface ComposerBridge {
  applyToComposer(draft: ComposerDraft): void;
}

/** The pick owner of Insights' elements: a new apply replaces the previous fix's chips. */
export const INSIGHTS_PICK_OWNER = 'surface:insights' as const;

/**
 * The targets of an API answer: its labelled `targets`, or — from an older answer —
 * its bare `selectors`, unlabelled.
 */
export function composerTargets(answer: { selectors?: string[] | null; targets?: ComposerTarget[] | null }): ComposerTarget[] {
  if (answer.targets && answer.targets.length > 0) return answer.targets;
  return (answer.selectors ?? []).map((selector) => ({ selector, label: '' }));
}

/**
 * THE bridge for a host with a composer: `composeDraft` puts the text in its prompt
 * (and shows the prompt); the targets become selector picks, chips in that prompt.
 */
export function composerBridgeFor(composeDraft: (text: string) => void, appName: string | null = null): ComposerBridge {
  return {
    applyToComposer({ prompt, targets, pagePath }) {
      composeDraft(prompt);
      const picks: PreviewPick[] = targets.map(({ selector, label }) => ({
        owner: INSIGHTS_PICK_OWNER,
        appName,
        anchor: { kind: 'selector', selector, label, pagePath },
      }));
      setPreviewPicks(INSIGHTS_PICK_OWNER, picks);
    },
  };
}

const ComposerBridgeContext = createContext<ComposerBridge | null>(null);

export const ComposerBridgeProvider = ComposerBridgeContext.Provider;

/** The composer bridge, when the host has a composer (null everywhere else). */
export function useComposerBridge(): ComposerBridge | null {
  return useContext(ComposerBridgeContext);
}
