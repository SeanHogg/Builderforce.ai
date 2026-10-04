/**
 * ONE stand-in for the Brain's model turn, for tests that mount `CreationCanvas`.
 *
 * The board used to carry its own keyword-matched fake turn behind
 * `process.env.NODE_ENV === 'test'` — production code that only tests ran, and that
 * produced notices and objects no real turn ever does. Tests now replace the model
 * call itself and leave every other step of the turn REAL: the runner below is what
 * `runCreationCanvasAi` resolves to, and anything it puts on the board goes through
 * the board's own `canvas_add_object` tool, the proposal stage, auto-apply and the
 * notices a user actually sees.
 *
 * Install it per file (vi.mock is hoisted, so the factory imports this lazily):
 *
 *   vi.mock('@/lib/creationCanvasAi', async (importOriginal) =>
 *     (await import('@/test/canvasTurnRunnerMock')).canvasTurnRunnerModule(
 *       await importOriginal<typeof import('@/lib/creationCanvasAi')>()));
 */
import { vi } from 'vitest';
import type * as CreationCanvasAi from '@/lib/creationCanvasAi';

export type CanvasTurnOptions = Parameters<typeof CreationCanvasAi.runCreationCanvasAi>[0];

/** What `runCreationCanvasAi` is while the mock is installed. */
export const canvasTurnRunner = vi.fn<(options: CanvasTurnOptions) => Promise<string>>(() => new Promise<string>(() => undefined));

/** The real module with only the model call replaced. */
export function canvasTurnRunnerModule(actual: typeof CreationCanvasAi): typeof CreationCanvasAi {
  return { ...actual, runCreationCanvasAi: canvasTurnRunner };
}

/** Every turn stays in flight and nothing leaves the test — the default. */
export function holdCanvasTurns(): void {
  canvasTurnRunner.mockReset();
  canvasTurnRunner.mockImplementation(() => new Promise<string>(() => undefined));
}

/**
 * Put one object on the board the way a model's tool call would: through the turn's
 * own `canvas_add_object` action. A refusal fails loudly — a fixture the tool would
 * reject is a fixture no real turn could produce.
 */
export async function stageCanvasObject(options: CanvasTurnOptions, args: Record<string, unknown>): Promise<void> {
  const tool = options.canvasActions.find((action) => action.name === 'canvas_add_object');
  if (!tool) throw new Error('canvas_add_object is not advertised to this turn');
  const result = await tool.run(args) as { error?: string } | undefined;
  if (result?.error) throw new Error(`canvas_add_object refused the fixture: ${result.error}`);
}

/** Answer every turn with `answer` — after `delayMs`, and having staged `object` if given. */
export function answerCanvasTurns(answer: string, { object, delayMs = 0 }: { object?: Record<string, unknown>; delayMs?: number } = {}): void {
  canvasTurnRunner.mockReset();
  canvasTurnRunner.mockImplementation(async (options) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (object) await stageCanvasObject(options, object);
    return answer;
  });
}

/** A fully authored evaluation — passes the tool's empty-shell check. */
export const AUTHORED_EVALUATION = {
  kind: 'evaluation',
  title: 'Canvas evaluation',
  fields: {
    content: 'The board covers the launch plan end to end; the pricing page has no owner yet.',
    verdict: 'Ready for review once pricing has an owner.',
  },
} as const;
