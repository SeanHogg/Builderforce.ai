/**
 * The canvas's BUILD vocabulary — creating, reading, searching and editing the
 * code behind a Builder object, from the board.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * The canvas advertised 60 `canvas_*` tools and not one of them touched a file,
 * a build, or a line of code. The code actions (`create_file`,
 * `apply_code_to_active_file`) were registered by `<BuilderWorkspace>` itself,
 * so they existed ONLY while a Builder panel happened to be open on a bound
 * project. "Build me an app", typed at the canvas prompt — the front door — had
 * no path to code at all unless the person already knew to create a Builder
 * object and open it first.
 *
 * Worse, the two actions that did exist were blind and blunt: no list, no read,
 * no search, and every write was a WHOLE FILE. The model's entire view of a
 * project was the open file, truncated to 4 000 characters, so the second prompt
 * against a multi-file app was authored without knowledge of what the first one
 * had built.
 *
 * ── WHY THESE NAMES ─────────────────────────────────────────────────────────
 * `list_files` / `read_file` / `search_code` / `write_file` / `edit_file` is the
 * vocabulary the CLOUD runner already advertises (`cloudAgentTools.ts`, under
 * `repo.read` / `repo.search` / `repo.write` / `repo.edit`), and it is a good
 * vocabulary — models are fluent in it. These are the same verbs behind the
 * `canvas_` prefix every canvas tool carries, so one model reads one set of
 * habits across both surfaces. The prefix is not decoration: the guest boundary
 * in `packages/creation-canvas-contract` is drawn over `canvas_*` names, and a
 * tool that reaches a tenant's workspace must be classifiable there.
 *
 * ── WHY A MODULE AND NOT MORE OF CreationCanvas.tsx ─────────────────────────
 * The canvas component is already ~9 700 lines with one ~3 700-line `useMemo`
 * holding every action inline. Adding seven more there would be the cheapest
 * thing to write and the most expensive thing to own. These are pure functions
 * over an injected context, so they are unit-testable without React, a canvas,
 * or an in-browser runtime.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────
 * Every write goes through {@link validateFileContentForPath}, the SAME guard
 * the workspace's own editor uses. A model writing CSS into `package.json` broke
 * Run in a way that took a long time to diagnose; there is exactly one place
 * that decision is made and this is not a second one.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { canvasRunBuildCommandAction } from '@/lib/canvasBuildCommandAction';
import { canvasReadBuildFileAction } from '@/lib/canvasBuildReads';
import { canvasReadPreviewConsoleAction } from '@/lib/canvasPreviewConsoleAction';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { BUILDABLE_MODALITIES, appModalityFor, workspacePathArg, resolveCanvasBuild, buildWorkspaceHelpers } from '@/lib/canvasBuildContext';
import type { CanvasBuildToolsContext } from '@/lib/canvasBuildContext';
import { canvasBuildFileActions } from '@/lib/canvasBuildFileActions';
import { canvasBuildHistoryActions } from '@/lib/canvasBuildHistoryActions';

// The vocabulary's public surface stays here; its parts live beside it.
export {
  BUILDABLE_MODALITIES, MAX_SEARCH_MATCHES, NO_HISTORY, appModalityFor, applySearchReplace, hasCodeWorkspace,
  resolveCanvasBuild, searchFileLines, summarizeWorkspace, workspacePathArg,
} from '@/lib/canvasBuildContext';
export type { BoundCanvasBuild, CanvasBuildToolsContext } from '@/lib/canvasBuildContext';
export { MAX_READ_CHARS, MAX_READ_FILES } from '@/lib/canvasBuildReads';
export {
  CANVAS_BUILD_FILE_WRITE_TOOLS, CANVAS_BUILD_TOOLS, CANVAS_BUILD_TOOL_NAMES, CANVAS_BUILD_WORKSPACE_WRITE_TOOLS,
} from '@/lib/canvasBuildToolNames';

/**
 * The canvas's build actions.
 *
 * Every one resolves its target build through {@link resolveCanvasBuild}, so the
 * "which build?" answer cannot differ between tools, and every write revalidates
 * through the shared content guard.
 */
export function canvasBuildActions(ctx: CanvasBuildToolsContext): BrainAction[] {
  const helpers = buildWorkspaceHelpers(ctx);
  const { workspacePaths } = helpers;
  const files = canvasBuildFileActions(ctx, helpers);

  const create: BrainAction = {
    name: 'canvas_create_build',
    description: 'Create a real, runnable code workspace on this board and return its Builder object. Use this the moment the user asks for a website, a web app, or a mobile app — it provisions a seeded starter project (Vite + React for a website, React Native for mobile) that runs in the browser preview and can be published to a real URL. After it returns, author the app with canvas_write_build_file / canvas_edit_build_file. Do NOT describe an app in a document object when the user asked for a working one.',
    mutates: true,
    parameters: {
      type: 'object', required: ['title', 'modality'], additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Short product name, e.g. "Recipe Box".' },
        modality: {
          type: 'string',
          enum: [...BUILDABLE_MODALITIES],
          description: 'designer = a website or web app; mobile = a React Native phone app; webmobile = one codebase that is both.',
        },
      },
    },
    run: async (raw: unknown) => {
      const args = raw as { title?: unknown; modality?: unknown };
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      if (!title) return { error: 'A title is required.' };
      const modality = appModalityFor(args.modality, false);
      try {
        const build = await ctx.createBuild({ title, modality });
        const paths = await workspacePaths(build.store).catch((): string[] => []);
        return {
          ok: true,
          applied: true,
          object: { id: build.objectId, kind: 'build', title: build.title },
          modality,
          files: paths,
          next: 'The workspace is seeded and runnable. Edit the starter files with canvas_edit_build_file (or canvas_write_build_file for a new file) to build what the user asked for.',
        };
      } catch (error) {
        return { error: toolErrorMessage(error, 'The workspace could not be created.') };
      }
    },
  };

  return [
    create,
    files.list,
    canvasReadBuildFileAction({ builds: () => ctx.builds(), resolve: resolveCanvasBuild, pathArg: workspacePathArg }),
    files.search,
    files.write,
    files.edit,
    ...canvasBuildHistoryActions(ctx, helpers),
    canvasRunBuildCommandAction(ctx, (objectId) => resolveCanvasBuild(ctx.builds(), objectId)),
    canvasReadPreviewConsoleAction((objectId) => resolveCanvasBuild(ctx.builds(), objectId)),
  ];
}
