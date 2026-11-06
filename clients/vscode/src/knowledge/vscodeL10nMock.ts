/** A stand-in for `vscode` in the knowledge fix tests: `l10n.t` returns the English with `{0}` filled, as the real one does without a bundle. Used as `vi.mock("vscode", async () => (await import("./vscodeL10nMock")).vscodeL10nMock)`. */
export const vscodeL10nMock = {
  l10n: { t: (message: string, ...args: unknown[]): string => message.replace(/\{(\d+)\}/g, (_m, i: string) => String(args[Number(i)])) },
};
