export declare const PREVIEW_LOG_LINES: number;
export declare const PREVIEW_LOG_LINE_CHARS: number;

export interface LogRing {
  push(chunk: unknown): void;
  tail(n: number): string[];
}

export declare function createLogRing(options?: { maxLines?: number; maxLineChars?: number }): LogRing;

export interface SpawnedChild {
  pid?: number;
  stdout?: { on(event: 'data', listener: (data: unknown) => void): unknown } | null;
  stderr?: { on(event: 'data', listener: (data: unknown) => void): unknown } | null;
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  unref?(): void;
}

export interface PreviewProcess {
  command: string;
  start(): SpawnedChild;
  restart(): SpawnedChild;
  exitCode(): number | string | null;
  running(): boolean;
  tail(n: number): string[];
}

export declare function createPreviewProcess(options: {
  command: string;
  cwd: string;
  extraEnv?: Record<string, string>;
  spawn(command: string, options: { cwd: string; extraEnv?: Record<string, string>; stdio: unknown }): SpawnedChild;
  kill(child: SpawnedChild): void;
  ring?: LogRing;
}): PreviewProcess;
