'use client';

/**
 * Registers the `show_canvas` Brain tool: lets the Brain generate a visual board
 * (text + sticky notes) and show it in the global canvas slide-out — over
 * /brainstorm or the floating drawer. The same reusable <CanvasBoard> backs both
 * the Brain board and the Knowledge canvas editor, so a board generated here can
 * be saved straight into Knowledge from the panel header.
 *
 * Mounted inside CanvasPanelProvider (to drive the drawer) and the Brain action
 * providers (so the tool reaches the model) — see ConditionalAppShell. Renders no
 * UI (mirrors AiInsightPanelBrainBridge).
 */

import { useMemo } from 'react';
import { useRegisterBrainActions, type BrainAction } from '@/lib/brain';
import { newBlockId, STICKY_COLORS, type CanvasBlock, type CanvasModel } from './canvasModel';
import { useOptionalCanvasPanel } from './CanvasPanelProvider';

interface ShowCanvasArgs {
  title?: string;
  text?: string;
  stickies?: string[];
}

/** Lay the requested pieces out into a board: intro text on top, stickies in a grid. */
function buildModel(args: ShowCanvasArgs): CanvasModel {
  const blocks: CanvasBlock[] = [];
  let y = 24;
  if (args.text && args.text.trim()) {
    blocks.push({ id: newBlockId(), type: 'text', x: 24, y, w: 320, h: 130, text: args.text.trim() });
    y += 152;
  }
  const stickies = Array.isArray(args.stickies) ? args.stickies.filter((s) => typeof s === 'string' && s.trim()) : [];
  stickies.forEach((s, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    blocks.push({
      id: newBlockId(),
      type: 'sticky',
      x: 24 + col * 200,
      y: y + row * 180,
      w: 180,
      h: 160,
      text: s.trim(),
      color: STICKY_COLORS[i % STICKY_COLORS.length] ?? STICKY_COLORS[0]!,
    });
  });
  return { version: 1, blocks };
}

export function CanvasPanelBrainBridge() {
  const panel = useOptionalCanvasPanel();
  const open = panel?.open;

  const actions = useMemo<BrainAction[]>(() => {
    if (!open) return [];
    return [
      {
        name: 'show_canvas',
        description:
          'Open a visual canvas board in a slide-out side panel and populate it with notes. ' +
          'Use this when the user wants to brainstorm visually, map ideas, run a retro, plan on a board, or see ideas as sticky notes. ' +
          'Provide a short intro `text` block and a list of `stickies` (one idea per note). The user can then drag, edit, add timers, and save the board to Knowledge.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Board title shown in the panel header.' },
            text: { type: 'string', description: 'Optional intro/context text placed as a block at the top of the board (Markdown).' },
            stickies: {
              type: 'array',
              items: { type: 'string' },
              description: 'Sticky-note texts to place on the board — one idea/item per string.',
            },
          },
        },
        mutates: false,
        run: (args: unknown) => {
          const a = (args ?? {}) as ShowCanvasArgs;
          const model = buildModel(a);
          open(model, typeof a.title === 'string' ? a.title : undefined);
          return { opened: true, title: a.title ?? null, blocks: model.blocks.length };
        },
      },
    ];
  }, [open]);

  useRegisterBrainActions(actions);
  return null;
}
