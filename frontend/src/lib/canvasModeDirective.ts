import type { ChatMode } from '@seanhogg/builderforce-brain-embedded';

/**
 * The MODE block for a canvas turn.
 *
 * The Canvas is not a Brain chat — it has no `chatId`, so it cannot use the shared
 * `chatModeDirective` (whose whole contract is "tie this to chat #N"). What carries
 * over is the DISTINCTION: chat authors on the board and answers; work leaves a
 * tracked, dispatched ticket behind. Tool names are the ADVERTISED `builtin_*` names
 * the model is actually given — a catalog id here would name a tool that appears
 * nowhere in its tool list (see api/scripts/check-prompt-tool-names.mjs).
 *
 * Its own module for the reason `founderCanvasPrompt.ts` states: prompt CONTENT is not
 * orchestration. `creationCanvasAi.ts` assembles the turn — the message list, the tool
 * loop, the guest branch — and instructional text belongs beside the other prompt
 * blocks rather than inside the runner.
 */
export function canvasModeDirective(mode: ChatMode, projectId: number | null | undefined): string {
  if (mode !== 'work') {
    return 'MODE: CHAT. This session is a working conversation on the canvas. Author, refine and explain the objects the user asks for, and answer their questions. Do NOT create board tickets, assign owners, or dispatch agent runs as a side effect — unless the user explicitly asks for that in this message. If something clearly ought to be tracked as work, say so in one line and leave the decision to them.';
  }
  const target = projectId != null
    ? `Use project ${projectId} unless the user names another.`
    : 'This session is not bound to a project yet — ask which project the work belongs to before creating anything, and do not guess.';
  return (
    'MODE: WORK. This session exists to get something DONE, not only to draw it. Carry the work through to a running agent.\n'
    + `• When the canvas work implies something that must actually happen, create the ticket with builtin_tasks_create (exactly one assignee, taskType "task", "epic" or "gap"). ${target}\n`
    + '• Scope it before reporting success: builtin_kanban_participants for the template manifest, builtin_kanban_assess_resource for each role the description implies, then builtin_kanban_accountability, and report any unstaffed gaps plainly.\n'
    + '• FINISH BY DISPATCHING. builtin_tasks_create and builtin_tasks_update return an `autoRun` verdict — read it. If `autoRun.dispatched` is true, name the agent that picked the work up. If it is false, start the work yourself with builtin_kanban_coordinate, which dispatches the next required role-capable participant. If dispatch is refused, report the EXACT reason the tool returned and what would clear it.\n'
    + '• Never imply work has begun when nothing was dispatched, and never describe a tool call you did not make. Mirror the created ticket back onto the canvas with canvas_add_object so the board and the canvas agree.'
  );
}
