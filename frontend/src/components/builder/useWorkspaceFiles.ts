// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { scaffoldForModality, isScaffoldPath } from '@builderforce/ide-templates';
import { validateFileContentForPath } from '@builderforce/ide-file-contract';
import { datasetNameForPath, looksLikeDatasetPath, parseJsonlDataset } from '@/lib/datasetFromFile';
import { saveFile, fetchFileContent, deleteFile, fetchFiles, importCanvasDataset } from '@/lib/api';
import { subscribeWorkspaceFiles } from '@/lib/workspaceFileEvents';
import type { RunLog } from '@/lib/runLog';
import type { FileEntry } from '@/lib/types';
import type { ProjectModality } from '@/lib/modality';

type WriteResult = { ok: true } | { ok: false; reason: string };

/**
 * The project's files as the editor sees them: which are open, which is active,
 * and every way a file changes — typed in the editor, created or deleted in the
 * tree, written by the docked Brain, or written from the board — each one saved,
 * pushed into the running preview, and refused when structurally invalid.
 *
 * The file list and contents are the HOST's state (the run pipeline reads them
 * too); this hook owns the editor's view of them and the writes.
 */
export function useWorkspaceFiles({ projectId, modality, setFiles, fileContents, setFileContents, previewUrl, writePreviewFile, refLog, onOpenInEditor }: {
  projectId: number;
  modality: ProjectModality;
  setFiles: Dispatch<SetStateAction<FileEntry[]>>;
  fileContents: Record<string, string>;
  setFileContents: Dispatch<SetStateAction<Record<string, string>>>;
  previewUrl: string | undefined;
  writePreviewFile: (path: string, contents: string) => Promise<void>;
  refLog: RunLog;
  /** Bring the editor forward (a file was opened from the tree). */
  onOpenInEditor: () => void;
}) {
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | undefined>();
  // Bumped when a corpus is registered from outside the Train panel (the Brain
  // writing a .jsonl into the workspace), so the dataset picker re-reads.
  const [datasetsRegistered, setDatasetsRegistered] = useState(0);

  /** Best-effort: a running preview picks the edit up without a restart. */
  const pushToPreview = useCallback((path: string, contents: string) => {
    if (previewUrl) writePreviewFile(path, contents).catch(() => { /* best-effort */ });
  }, [previewUrl, writePreviewFile]);

  const refreshFiles = useCallback(async () => {
    try {
      setFiles(await fetchFiles(projectId));
    } catch { /* silent */ }
  }, [projectId, setFiles]);

  const openFile = useCallback(async (path: string) => {
    onOpenInEditor();
    if (fileContents[path] !== undefined) {
      setActiveFile(path);
      setOpenFiles(prev => (prev.includes(path) ? prev : [...prev, path]));
      return;
    }
    try {
      const content = await fetchFileContent(projectId, path);
      setFileContents(prev => ({ ...prev, [path]: content }));
      setOpenFiles(prev => (prev.includes(path) ? prev : [...prev, path]));
      setActiveFile(path);
    } catch (e) {
      // Do NOT cache '' on failure: that poisons fileContents so the cached
      // branch above short-circuits every future open and the file shows blank
      // forever. Leave the path uncached so the next click re-fetches; still
      // open the tab so the user sees something happened.
      console.error(`Failed to load ${path}:`, e);
      refLog.error('fileLoadFailed', { path });
      setOpenFiles(prev => (prev.includes(path) ? prev : [...prev, path]));
      setActiveFile(path);
    }
  }, [fileContents, projectId, refLog, onOpenInEditor, setFileContents]);

  const closeTab = useCallback((path: string) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f !== path);
      if (activeFile === path) setActiveFile(next[next.length - 1]);
      return next;
    });
  }, [activeFile]);

  const editActiveFile = useCallback(async (value: string) => {
    if (!activeFile) return;
    // Always reflect the keystroke locally (never lose typing).
    setFileContents(prev => ({ ...prev, [activeFile]: value }));
    // But NEVER PERSIST structurally-invalid content — the same guard the Brain's
    // writes use, so a cross-wired write (HTML landing in package.json) is never
    // saved and never breaks the preview [1315]. Someone mid-way through typing
    // an invalid JSON state just defers the save until it parses.
    if (!validateFileContentForPath(activeFile, value).ok) return;
    pushToPreview(activeFile, value);
    try {
      await saveFile(projectId, activeFile, value);
    } catch (e) {
      console.error('Failed to save:', e);
    }
  }, [activeFile, projectId, pushToPreview, setFileContents]);

  const createFile = useCallback(async (path: string) => {
    // Creating a file posts an EMPTY body by construction — which is exactly the
    // 0-byte write the API refuses at a scaffold path. At such a path "create"
    // means "restore the starter file", so seed the template content instead.
    const seed = isScaffoldPath(path) ? (scaffoldForModality(modality)?.[path] ?? '') : '';
    try {
      await saveFile(projectId, path, seed);
      setFiles(prev => [...prev, { path, content: seed, type: 'file' }]);
      setFileContents(prev => ({ ...prev, [path]: seed }));
      void openFile(path);
    } catch (e) {
      console.error('Failed to create file:', e);
    }
    await refreshFiles();
  }, [projectId, openFile, modality, refreshFiles, setFiles, setFileContents]);

  const removeFile = useCallback(async (path: string) => {
    try {
      await deleteFile(projectId, path);
      setFiles(prev => prev.filter(f => f.path !== path));
      closeTab(path);
    } catch (e) {
      console.error('Failed to delete file:', e);
    }
    await refreshFiles();
  }, [projectId, closeTab, refreshFiles, setFiles]);

  /**
   * A file was written from the BOARD (the canvas build tools write over the API
   * whether or not this workspace is mounted). Without this the editor would keep
   * showing the pre-edit buffer — and the next manual save would write the stale
   * text back over the agent's work. Re-reads the changed files, refreshes the
   * tree, and pushes them into the running preview.
   */
  useEffect(() => subscribeWorkspaceFiles((storageProjectId, paths) => {
    if (storageProjectId !== projectId) return;
    void refreshFiles();
    for (const path of paths) {
      void fetchFileContent(projectId, path)
        .then((content) => {
          setFileContents((prev) => (prev[path] === content ? prev : { ...prev, [path]: content }));
          pushToPreview(path, content);
        })
        .catch(() => { /* the file may have been deleted between write and read */ });
    }
  }), [projectId, refreshFiles, pushToPreview, setFileContents]);

  /** The Brain's whole-file write into the open file. */
  const applyCodeToActiveFile = useCallback((code: string): WriteResult => {
    if (!activeFile) return { ok: false, reason: 'No file is open in the editor.' };
    const valid = validateFileContentForPath(activeFile, code);
    if (!valid.ok) { console.error(valid.reason); return valid; }
    setFileContents(prev => ({ ...prev, [activeFile]: code }));
    pushToPreview(activeFile, code);
    saveFile(projectId, activeFile, code).catch(console.error);
    return { ok: true };
  }, [activeFile, projectId, pushToPreview, setFileContents]);

  /** The Brain's new-file write; opens the file once it is saved. */
  const createProjectFile = useCallback((path: string, content: string): WriteResult => {
    const valid = validateFileContentForPath(path, content);
    if (!valid.ok) { console.error(valid.reason); return valid; }
    setFileContents(prev => ({ ...prev, [path]: content }));
    pushToPreview(path, content);
    saveFile(projectId, path, content)
      .then(() => {
        // A corpus written as a FILE must also become a registered dataset, or a
        // `data/train.jsonl` the Brain produced is invisible to the fine-tune
        // picker. Strictly detected, and best-effort: a registration failure must
        // never lose the file the user just got.
        if (looksLikeDatasetPath(path)) {
          const examples = parseJsonlDataset(content);
          if (examples && examples.length > 0) {
            importCanvasDataset({
              projectId,
              name: datasetNameForPath(path),
              examples,
              capabilityPrompt: `Written into the workspace as ${path}`,
            })
              .then(() => setDatasetsRegistered((n) => n + 1))
              .catch((e) => console.error(`Created ${path} but could not register it as a dataset:`, e));
          }
        }
        void refreshFiles();
        if (!openFiles.includes(path)) {
          setOpenFiles(prev => [...prev, path]);
          setActiveFile(path);
        }
      })
      .catch(console.error);
    return { ok: true };
  }, [projectId, refreshFiles, openFiles, pushToPreview, setFileContents]);

  return {
    openFiles,
    activeFile,
    setActiveFile,
    openFile,
    closeTab,
    editActiveFile,
    createFile,
    removeFile,
    refreshFiles,
    applyCodeToActiveFile,
    createProjectFile,
    datasetsRegistered,
  };
}
