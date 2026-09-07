// No 'use client' directive: this is only ever rendered by `CreationCanvas`, which is
// already a client component, so the boundary is inherited and a second declaration here
// would only add another file to the architecture ratchet's client-component tally — the
// same reason `CanvasSessionActions` and `CanvasCommandBar` omit it.
import { forwardRef, useCallback, useImperativeHandle, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { SectionTour, type SectionTourStep } from '@/components/onboarding/SectionTour';
import { useSectionTour } from '@/components/onboarding/useSectionTour';
import type { CanvasWalkthroughStop } from '@/lib/canvasWalkthrough';

/** `CSS.escape`, or a conservative stand-in where the environment has none. */
function escapeSelectorValue(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');
}

/**
 * "SHOW ME WHAT I JUST GOT."
 *
 * The canvas already had a tour and it toured the CHROME — the Brain dock, the
 * palette, Share. That is the right tour for somebody's first board and the
 * wrong one for the moment people actually get stuck: a prompt has just produced
 * two dozen objects and the question is not "where is the palette", it is "what
 * are all of these and which one do I touch first".
 *
 * So this walks the ARTIFACTS. `lib/canvasWalkthrough.ts` decides what the stops
 * are and what order they come in — from the board's own connections, not from a
 * hand-written running order — and this turns each into a coach mark over the
 * real card, pans the board to it, and says what it is.
 *
 * ── WHY IT REUSES `SectionTour` ──────────────────────────────────────────────
 * Because a second coach-mark implementation is a second set of answers to focus
 * trapping, escape, spotlight geometry, the reduced-motion rule and the phone
 * layout — and the existing one already has all of them, tested. What is
 * different here is only WHAT is pointed at: React Flow stamps `data-id` on
 * every node wrapper, so a board object is addressable by exactly the CSS
 * selector `SectionTour` already takes. The one thing a DOM selector cannot do
 * is bring an off-screen card into view — the board is a transform, not a scroll
 * container — so `onReveal` moves the viewport as each step opens.
 *
 * ── WHY THE HOST DOES NOT OWN THE STATE ──────────────────────────────────────
 * Offered-once-per-board, which step you are on, and whether you dismissed it
 * live here, behind one imperative `open()`. The host has a session action to
 * wire and nothing else to know, and this component can be dropped on any canvas
 * that can name a board and reveal an object.
 */

export interface CanvasWalkthroughHandle {
  /** Open the offer card. What the session bar's Walkthrough action calls. */
  open: () => void;
}

export interface CanvasWalkthroughProps {
  /**
   * The board being walked. Part of the storage key, so taking the walkthrough
   * on one board does not silently spend the offer on the next one.
   */
  boardId: string;
  /** Who is being shown round; null while nobody is identified, which withholds the offer. */
  audienceId: string | null;
  /** Derived by `canvasWalkthroughStops`. Empty means there is nothing worth walking. */
  stops: readonly CanvasWalkthroughStop[];
  /**
   * A turn is still writing to this board.
   *
   * Objects arrive one tool call at a time, so a big generation crosses the
   * "enough to be lost in" threshold long before it finishes — and an offer to
   * walk somebody round a board that is still growing under them would be the
   * product interrupting its own work. Host state by nature: nothing the
   * component can see tells it whether more is coming.
   *
   * It only gates the OFFER. Pressing the action opens it whatever is happening,
   * because that is somebody asking.
   */
  busy?: boolean;
  /** Bring an object into view and select it. The board owns its viewport. */
  onReveal: (objectId: string) => void;
}

/**
 * Bumped when the STOPS change shape enough that somebody who took the old
 * walkthrough should be offered the new one. Not on a copy edit.
 */
const WALKTHROUGH_VERSION = 1;

export const CanvasWalkthrough = forwardRef<CanvasWalkthroughHandle, CanvasWalkthroughProps>(
  function CanvasWalkthrough({ boardId, audienceId, stops, onReveal, busy = false }, ref) {
    const t = useTranslations('creationCanvas.walkthrough');
    const tCanvas = useTranslations('creationCanvas');
    const objectT = useTranslations('creationCanvas.object');

    const objectCount = useMemo(() => stops.reduce((total, stop) => total + stop.count, 0), [stops]);

    const steps = useMemo<SectionTourStep[]>(() => stops.map((stop) => {
      // The kind's own localized name, from the catalog the inspector and the
      // outline already read. A walkthrough that spelled "Customer segment" a
      // second time would be a second place to translate it.
      const kind = objectT(stop.kind as never);
      return {
        title: stop.count > 1
          ? t('stopTitleMany', { kind, count: stop.count })
          : t('stopTitleOne', { kind, title: stop.leadTitle || kind }),
        body: [
          stop.count > 1
            ? t('stopBodyMany', { kind, count: stop.count, title: stop.leadTitle || kind })
            : (stop.summary || t('stopBodyOne', { kind })),
          stop.overflowKinds > 0 ? t('stopOverflow', { count: stop.overflowKinds }) : '',
        ].filter(Boolean).join(' '),
        // React Flow's own node attribute — see the header for why this is the
        // whole integration rather than a bespoke highlighter. Object ids are
        // UUIDs and need no escaping, but they are not guaranteed to be, and a
        // selector built from unescaped data is how a tour silently points at
        // nothing; `CSS.escape` is absent in some test environments, so the
        // fallback keeps the id usable rather than throwing on render.
        target: `.react-flow__node[data-id="${escapeSelectorValue(stop.focusObjectId)}"]`,
      };
    }), [objectT, stops, t]);

    const tour = useSectionTour({
      sectionId: `creation-canvas-artifacts:${boardId}`,
      version: WALKTHROUGH_VERSION,
      audienceId,
      // Withheld while there is nothing to walk AND while the board is still
      // being written — see `busy`. Withholding rather than hiding matters: the
      // hook records the visit that spends the once-per-board offer, so enabling
      // it early would burn the offer on a board half of which did not exist yet.
      enabled: steps.length > 0 && !busy,
      activity: { boardId, stops: steps.length, objects: objectCount },
    });

    useImperativeHandle(ref, () => ({ open: tour.openOffer }), [tour.openOffer]);

    const revealStop = useCallback((step: number) => {
      const stop = stops[step];
      if (stop) onReveal(stop.focusObjectId);
    }, [onReveal, stops]);

    if (!steps.length) return null;

    return <SectionTour
      phase={tour.phase}
      step={tour.step}
      steps={steps}
      label={t('label')}
      offerTitle={t('offerTitle', { count: objectCount })}
      offerBody={t('offerBody', { count: steps.length })}
      startLabel={t('start')}
      cancelLabel={tCanvas('tourCancel')}
      closeLabel={tCanvas('tourClose')}
      backLabel={tCanvas('back')}
      nextLabel={tCanvas('next')}
      finishLabel={t('finish')}
      stepLabel={(current, total) => t('step', { step: current, total })}
      onStart={tour.start}
      onCancel={tour.cancel}
      onNext={() => tour.next(steps.length)}
      onBack={tour.back}
      onStepChange={revealStop}
    />;
  },
);
