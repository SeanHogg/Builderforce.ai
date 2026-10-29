import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { READ_FILE_MAX_CHARS, windowReadFiles } from '@builderforce/tool-output-policy';

/**
 * `canvas_read_build_file` — read files from a Builder object's workspace.
 *
 * Split out of `canvasBuildTools.ts`. The tool reads; the SHARED paging policy
 * (`@builderforce/tool-output-policy`'s `windowReadFiles`) cuts what one call hands back, at a
 * LINE, with `truncated`, the line it stopped at and the `offset` that continues it — the same
 * rule the agent applies to every read, so a cut file can never reach the model unmarked.
 */

/**
 * Read cap for one `canvas_read_build_file` call, shared by every file it reads: the paging
 * policy's own ceiling for a read (`READ_FILE_MAX_CHARS`), so the tool never hands back more
 * than the agent would let through — and the number cannot be one that never binds.
 */
export const MAX_READ_CHARS = READ_FILE_MAX_CHARS;

/**
 * Files one `canvas_read_build_file` call may read.
 *
 * A read took ONE path, so every file was one model round-trip — and each round-trip
 * re-sends the whole conversation and every tool schema. Measured (session
 * `local-148925cf`, ui 2026.10.45): fixing three missing stylesheet imports spent 11 of
 * the turn's 16 steps on single-file reads, ran out of steps after the fix, and never
 * told the user it was fixed. Eight covers the files one change touches.
 */
export const MAX_READ_FILES = 8;

/** What the read needs of the build tools it is part of (passed in: no import back). */
export interface BuildReadDeps<B extends { store: { read(path: string): Promise<string> } }> {
  /** The builds bound to this board. */
  builds: () => B[];
  /** Which build a call is about; an `{ error }` when it cannot say. */
  resolve: (builds: B[], objectId: unknown) => { build: B } | { error: string };
  /** One reading of a model-supplied path. */
  pathArg: (value: unknown) => string;
}

type FileEntry = { path: string; content: string; truncated: boolean; offset: number; totalLines: number };

export function canvasReadBuildFileAction<B extends { store: { read(path: string): Promise<string> } }>(deps: BuildReadDeps<B>): BrainAction {
  return {
    name: 'canvas_read_build_file',
    description: `Read files from a Builder object's workspace. Pass \`paths\` to read up to ${MAX_READ_FILES} files in ONE call — every file a change touches (a page and its stylesheet, the component and what imports it) — instead of one call per file. Always read a file before editing it: canvas_edit_build_file needs the exact existing text to anchor against.`,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        paths: { type: 'array', items: { type: 'string' }, maxItems: MAX_READ_FILES, description: 'Workspace-relative paths, e.g. ["src/pages/Login.jsx", "src/pages/Auth.css"].' },
        path: { type: 'string', description: 'One workspace-relative path. Use paths for more than one file.' },
        offset: { type: 'integer', minimum: 1, description: 'Single-file reads only: the 1-based line to start from. A large file arrives in windows; the result names the offset that continues it.' },
        objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' },
      },
    },
    run: async (raw: unknown) => {
      const args = raw as { path?: unknown; paths?: unknown; objectId?: unknown; offset?: unknown };
      const requested = [...new Set([
        ...(Array.isArray(args.paths) ? args.paths : []),
        args.path,
      ].map(deps.pathArg).filter(Boolean))];
      if (!requested.length) return { error: 'A path is required — pass paths: ["src/App.jsx", …].' };
      if (requested.length > MAX_READ_FILES) return { error: `Read at most ${MAX_READ_FILES} files per call; split the rest into another call.` };
      const resolved = deps.resolve(deps.builds(), args.objectId);
      if ('error' in resolved) return resolved;
      const { store } = resolved.build;
      // A model may send the offset as a number or as the digits of one.
      const wanted = Math.floor(Number(args.offset));
      const read: Array<FileEntry | { path: string; error: string }> = [];
      for (const path of requested) {
        try {
          const whole = await store.read(path);
          // A window starts at the line the model asked for (one file only); `totalLines` is the
          // whole file's, so the paging policy can say where a window stopped.
          const lines = whole.split('\n');
          const start = requested.length === 1 && wanted > 1 ? Math.min(wanted, lines.length) : 1;
          read.push({ path, content: start > 1 ? lines.slice(start - 1).join('\n') : whole, truncated: false, offset: start, totalLines: lines.length });
        } catch {
          read.push({ path, error: `No file "${path}" in this workspace.` });
        }
      }
      // The shared budget is split across the files and each is paged at a line on its own.
      const windowed = windowReadFiles({ ok: true, files: read }, { tool: 'canvas_read_build_file', maxChars: MAX_READ_CHARS });
      const files = windowed.served.files as Array<FileEntry & { error?: string }>;
      // One file keeps the single-file shape every caller and trace already reads.
      if (files.length === 1) {
        const [file] = files;
        return file && 'error' in file && file.error
          ? { error: `${file.error} Call canvas_list_build_files to see what is there.` }
          : { ok: true, ...file };
      }
      const missing = files.filter((file) => 'error' in file).length;
      return {
        ok: missing < files.length,
        files,
        ...(missing ? { next: 'Some paths do not exist. Call canvas_list_build_files to see what is there, and canvas_write_build_file to create a file an import expects.' } : {}),
      };
    },
  };
}
