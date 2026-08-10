/**
 * `web` — the game as it is, playable in the canvas frame.
 *
 * The only target with no adaptation at all: the document is written out
 * unchanged so that what the canvas plays, what gets published, and what gets
 * wrapped in an APK are demonstrably the same bytes. It exists as an adapter
 * rather than as a special case so the "download the game" path goes through the
 * same code as every other target and cannot drift from them.
 */

import type { GameTarget, GameTargetContext, GameTargetResult } from '../gameTarget';

export const webTarget: GameTarget = {
  key: 'web',
  label: 'Play here',
  summary: 'The game itself, played in a sandboxed frame on the canvas. Nothing to set up.',
  zeroSetup: true,
  device: 'browser',
  directory: (slug) => `games/${slug}/web`,
  materialize(ctx: GameTargetContext): GameTargetResult {
    const { game } = ctx;
    return {
      files: {
        'index.html': game.html,
        'README.md':
          `# ${game.title}\n\n${game.brief}\n\n`
          + 'This is one self-contained HTML document — no build step, no dependencies, no network.\n'
          + 'Open `index.html` in any browser to play it, or host it anywhere that serves a file.\n',
      },
      setupSteps: [],
      playUrl: null,
      detail: `Self-contained HTML document, ${game.html.length.toLocaleString()} characters`,
    };
  },
};
