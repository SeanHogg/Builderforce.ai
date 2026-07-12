// Platform resolver abstractions.
//
// The actual task/board API is not checked out on this sparse branch — only
// agent-runtime/extensions/** is present. These stubs define the integration
// surface so the tool compiles and tests run, and the host can inject real
// resolvers via api.pluginConfig / api.config once the full repo is present.

export interface RawFileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  linesAdded: number;
  linesDeleted: number;
  previousPath?: string;
  binary?: boolean;
}

export interface GitProviderDiffResponse {
  files: RawFileChange[];
  baseBranch: string;
  repoFullName: string;
  resolvedAt: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  prNumber?: number;
  branch?: string;
  repoFullName?: string;
}

export interface PlatformResolver {
  resolveTask: (taskId: string) => TaskRecord | Promise<TaskRecord | undefined> | undefined | Promise<undefined>;
  resolveProjectRepo: (projectId: string) => string | Promise<string>;
}

export interface DiffFetcher {
  fetchDiff: (
    repoFullName: string,
    baseBranch: string,
    headRef: string,
  ) => GitProviderDiffResponse | Promise<GitProviderDiffResponse>;
}

export function asRawFileChange(item: unknown, index: number): RawFileChange {
  if (!item || typeof item !== "object") {
    throw new Error(`Invalid file entry at index ${index}: expected object.`);
  }
  const o = item as Record<string, unknown>;
  if (typeof o.path !== "string") {
    throw new Error(`Invalid file entry at index ${index}: path is missing or not a string.`);
  }
  return {
    path: o.path as string,
    status: (o.status as RawFileChange["status"]) ?? "modified",
    linesAdded: (o.linesAdded as number) ?? 0,
    linesDeleted: (o.linesDeleted as number) ?? 0,
    previousPath: o.previousPath as string | undefined,
    binary: (o.binary as boolean) ?? false,
  };
}

export function normalizeFileChangeArray(files: ReadonlyArray<RawFileChange> | undefined): RawFileChange[] {
  return files?.slice() ?? [];
}
