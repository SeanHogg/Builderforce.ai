/** The text of a caught value: an Error's message, else the value as a string. The ONE copy (no `vscode`, so every layer — host, workers, tests — may import it). */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
