import { describe, expect, it } from "vitest";
import { isReadOnlyShellCommand } from "./readOnlyShell.js";

describe("isReadOnlyShellCommand — git's global options before the subcommand", () => {
  it.each([
    "git --git-dir /x/.git status",
    "git --work-tree /x --git-dir /x/.git log --oneline",
    "git -C repo -c core.pager=cat diff",
    "git --namespace ns show-ref",
  ])("a valued global option's value is not read as the subcommand: %s", (command) => {
    expect(isReadOnlyShellCommand(command)).toBe(true);
  });

  it.each(["git --git-dir /x/.git checkout main", "git -C repo switch dev", "git --work-tree /x commit -m x"])(
    "a writing subcommand after them still may write: %s",
    (command) => {
      expect(isReadOnlyShellCommand(command)).toBe(false);
    },
  );
});
