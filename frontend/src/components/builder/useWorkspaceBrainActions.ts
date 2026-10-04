// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useMemo, useRef } from 'react';
import { coerceFileContent } from '@builderforce/ide-file-contract';
import { canvasBuildActions } from '@/lib/canvasBuildTools';
import { notifyWorkspaceFilesChanged } from '@/lib/workspaceFileEvents';
import { isBrainAutoApprove } from '@/lib/brain/autoApprove';
import { useRegisterBrainActions, savePrd, saveTasks, type BrainAction } from '@/lib/brain';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { generateImageAssetAction } from './generateImageAssetAction';
import type { ProjectModality } from '@/lib/modality';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';

type WriteResult = { ok: true } | { ok: false; reason: string };

const NEEDS_PROJECT = 'Specs and tasks are saved to a project, and this workspace is held in this browser. Save the board to an account first.';

/** The live workspace state the tools act on. Read through a ref, so the
 *  registered action list stays stable while `run()` sees current values. */
export interface WorkspaceBrainTargets {
  activeFile: string | undefined;
  applyCodeToActiveFile: (code: string) => WriteResult;
  createProjectFile: (path: string, content: string) => WriteResult;
  setVoiceText: (text: string) => void;
}

/**
 * Register the workspace's capabilities as Brain tools: the canvas BUILD
 * vocabulary bound to this project (list / read / search / surgical edit — the
 * same implementation the board uses, minus `canvas_create_build`: an open
 * workspace has nothing to create), plus file creation, whole-file apply, AI
 * image generation for the app's pictures, the voice studio's lines, and the
 * PRD / task generators behind a review.
 */
export function useWorkspaceBrainActions({ store, projectName, modality, targets, review }: {
  /** The open workspace's files — what the build tools read and write. */
  store: WorkspaceFileStore;
  projectName: string;
  modality: ProjectModality;
  targets: WorkspaceBrainTargets;
  review: {
    requestPrd: (prd: string) => Promise<boolean>;
    requestTasks: (draft: { titles: string[]; descriptions: string[] }) => Promise<boolean>;
  };
}): void {
  // Specs and tasks belong to a durable project; a browser-held workspace has none.
  const projectId = typeof store.id === 'number' ? store.id : null;
  const liveRef = useRef({ targets, modality, projectId, review });
  // Synced after commit, never during render; a tool runs long after either.
  useEffect(() => {
    liveRef.current = { targets, modality, projectId, review };
  });

  const buildToolActions = useMemo<BrainAction[]>(() => canvasBuildActions({
    builds: () => [{ objectId: String(store.id), title: projectName, modality, store }],
    createBuild: async () => { throw new Error('This workspace is already open — edit its files instead of creating another build.'); },
    onFilesChanged: notifyWorkspaceFilesChanged,
  }).filter((action) => action.name !== 'canvas_create_build'), [modality, projectName, store]);

  const actions = useMemo<BrainAction[]>(() => [
    ...buildToolActions,
    generateImageAssetAction(),
    {
      name: 'create_file',
      // Steered at the surgical editor deliberately: this action also backs the
      // "Create file" button on a code block in a chat reply, so it cannot be
      // removed — but a model choosing between it and `canvas_edit_build_file`
      // for an EXISTING file should choose the one that cannot drop code.
      description: 'Create a NEW file in the current project and open it in the editor. To change a file that already exists, use canvas_edit_build_file instead — this action replaces the whole file and silently drops anything you did not reproduce.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative file path, e.g. src/App.jsx' },
          content: { type: 'string', description: 'Full file contents' },
        },
        required: ['path', 'content'],
      },
      run: async ({ path, content }: { path: string; content: unknown }) => {
        if (!path) return { error: 'A file path is required.' };
        // Models often emit a structured body (e.g. package.json) as an object —
        // coerce to text so the write never crashes on `.trim()` of a non-string.
        const res = liveRef.current.targets.createProjectFile(path, coerceFileContent(content));
        return res.ok ? { created: path } : { error: res.reason };
      },
    },
    {
      name: 'apply_code_to_active_file',
      description: "Replace the entire contents of the file currently open in the editor. Prefer canvas_edit_build_file, which changes only the part you name and costs a fraction of a rewrite; use this only when the whole file genuinely is being replaced.",
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: 'New full contents for the open file' } },
        required: ['code'],
      },
      run: async ({ code }: { code: unknown }) => {
        const res = liveRef.current.targets.applyCodeToActiveFile(coerceFileContent(code));
        return res.ok ? { applied: liveRef.current.targets.activeFile } : { error: res.reason };
      },
    },
    {
      name: 'set_narration_text',
      description: 'Load the lines to synthesize into the voice studio (voice modality only). The user presses Generate to render them.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The lines to narrate in the selected voice' } },
        required: ['text'],
      },
      run: async ({ text }: { text: string }) => {
        if (liveRef.current.modality !== 'voice') return { error: 'The project is not in Voice modality.' };
        liveRef.current.targets.setVoiceText(text ?? '');
        return { loaded: true };
      },
    },
    {
      name: 'generate_prd',
      description: 'Save a Product Requirements Document (markdown) to the project specs.',
      parameters: {
        type: 'object',
        properties: { prd: { type: 'string', description: 'The full PRD in markdown' } },
        required: ['prd'],
      },
      run: async ({ prd }: { prd: string }) => {
        if (!prd?.trim()) return { error: 'PRD content is empty.' };
        const { projectId: specsProjectId } = liveRef.current;
        if (specsProjectId === null) return { error: NEEDS_PROJECT };
        // Auto-approve skips the review — the user already opted out of
        // per-action prompts, so save straight through.
        if (isBrainAutoApprove()) {
          try {
            await savePrd(specsProjectId, prd.trim());
            return { saved: true };
          } catch (e) {
            return { error: toolErrorMessage(e, 'Failed to save PRD') };
          }
        }
        const saved = await liveRef.current.review.requestPrd(prd.trim());
        return saved ? { saved: true } : { saved: false, note: 'User declined to save the PRD.' };
      },
    },
    {
      name: 'generate_tasks',
      description: 'Add a list of actionable tasks to the project.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, description: { type: 'string' } },
              required: ['title'],
            },
          },
        },
        required: ['tasks'],
      },
      run: async ({ tasks }: { tasks: Array<{ title: string; description?: string }> }) => {
        const list = Array.isArray(tasks) ? tasks.filter(t => t?.title?.trim()) : [];
        if (list.length === 0) return { error: 'No tasks provided.' };
        const { projectId: tasksProjectId } = liveRef.current;
        if (tasksProjectId === null) return { error: NEEDS_PROJECT };
        const titles = list.map(t => t.title);
        const descriptions = list.map(t => t.description ?? '');
        if (isBrainAutoApprove()) {
          try {
            await saveTasks(tasksProjectId, { titles, descriptions });
            return { added: list.length };
          } catch (e) {
            return { error: toolErrorMessage(e, 'Failed to add tasks') };
          }
        }
        const saved = await liveRef.current.review.requestTasks({ titles, descriptions });
        return saved ? { added: list.length } : { added: 0, note: 'User declined to add the tasks.' };
      },
    },
    // Closures read only the live ref + module imports. `buildToolActions` is the
    // one real dependency: the tools must follow the workspace they edit.
  ], [buildToolActions]);

  useRegisterBrainActions(actions);
}
