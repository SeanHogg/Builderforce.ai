'use client';

/**
 * Registers the `show_canvas` Brain tool: the model lays a set of ideas out as notes and
 * OPENS THEM ON THE CANVAS.
 *
 * ── WHAT CHANGED, AND WHY ───────────────────────────────────────────────────
 * This tool used to build a board for the second canvas implementation
 * (`components/canvas/canvasModel.ts`) and show it in a right-hand slide-out, with a
 * "Save to Knowledge" button that serialised the board into a knowledge document's
 * `content` string. That was the seam the roadmap logged: two canvases owning
 * overlapping primitives, and only one of them the front door. A person who brainstormed
 * in the drawer could not move what they made to the board where the work happens.
 *
 * So the drawer is gone and the tool opens a REAL Creation Canvas session — the same
 * notes, on the canvas that is the front door, with everything that board never had:
 * connections, the object registry, history, sharing, export, and Brain itself.
 *
 * ── WHY A LOCAL SESSION ─────────────────────────────────────────────────────
 * `show_canvas` is reachable by a signed-out visitor from the Brain drawer. A tool that
 * created a server session would answer with an account gate where it used to answer
 * with a board — so it writes a local-first session, which is exactly what the product's
 * own anonymous Create flow does (PRD 21 §0) and is upgradeable by signing in.
 *
 * Mounted inside the Brain action providers — see `ConditionalAppShell`. Renders no UI.
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useRegisterBrainActions, type BrainAction } from '@/lib/brain';
import { createLocalCreationBoard } from '@/lib/creationSessions';

interface ShowCanvasArgs {
  title?: string;
  text?: string;
  stickies?: string[];
}

export function CanvasPanelBrainBridge() {
  const router = useRouter();

  const actions = useMemo<BrainAction[]>(() => [
    {
      name: 'show_canvas',
      description:
        'Open a visual canvas board and populate it with notes. '
        + 'Use this when the user wants to brainstorm visually, map ideas, run a retro, plan on a board, or see ideas as sticky notes. '
        + 'Provide a short intro `text` and a list of `stickies` (one idea per note). The board opens on the Creation Canvas, '
        + 'where the user can drag, edit, connect, add more objects and keep working with you.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Board title.' },
          text: { type: 'string', description: 'Optional intro/context, placed as a note at the top of the board.' },
          stickies: {
            type: 'array',
            items: { type: 'string' },
            description: 'Sticky-note texts to place on the board — one idea/item per string.',
          },
        },
      },
      // It NAVIGATES. Declared as mutating so the turn's own approval rules treat it as
      // an act rather than a read: opening a board replaces what the user is looking at,
      // which is not something a lookup does.
      mutates: true,
      run: (args: unknown) => {
        const input = (args ?? {}) as ShowCanvasArgs;
        const stickies = Array.isArray(input.stickies)
          ? input.stickies.filter((note): note is string => typeof note === 'string')
          : [];
        const sessionId = createLocalCreationBoard({
          ...(typeof input.title === 'string' ? { title: input.title } : {}),
          ...(typeof input.text === 'string' ? { text: input.text } : {}),
          stickies,
        });
        router.push(`/create/${sessionId}`);
        return { opened: true, sessionId, title: input.title ?? null, notes: stickies.length };
      },
    },
  ], [router]);

  useRegisterBrainActions(actions);
  return null;
}
