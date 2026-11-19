import { describe, expect, it } from "vitest";

import { isMutatingShellCall, isMutatingShellCommand } from "./mutatingShell.js";

describe("isMutatingShellCommand", () => {
  it("leaves builds, installs, checks, guard scripts and reads alone", () => {
    for (const cmd of [
      "pnpm build",
      "npm install",
      "pnpm why react",
      "node scripts/check-react-hooks-ratchet.mjs",
      "node scripts/check-design-scale.mjs",
      "gh pr view 12",
      "curl -s https://example.com/api",
      "awk '{print $1}' a.txt",
      "Get-Content src/a.ts",
      "pnpm run check 2>&1 | tail -40",
      "npx vitest run src/a.test.ts",
      "git log --oneline -5",
      "git add src/a.ts",
      "git stash list",
      "sort -u names.txt",
      "node -e \"console.log(require('fs').readFileSync('a.txt','utf8'))\"",
      "ls > /dev/null",
    ]) {
      expect(isMutatingShellCommand(cmd), cmd).toBe(false);
    }
  });

  it("flags known writers in ANY segment", () => {
    for (const cmd of [
      "echo x > src/a.ts",
      "cat a >> b.txt",
      "rm -rf dist",
      "mv a.ts b.ts",
      "cp a.ts b.ts",
      "echo hi | tee out.txt",
      "sed -i 's/a/b/' x.ts",
      "git commit -am wip",
      "git checkout -- src/a.ts",
      "git reset --hard",
      "git push origin main",
      "git stash",
      "git rebase main",
      "git merge feature",
      "git apply fix.patch",
      "node -e \"require('fs').writeFileSync('frontend/src/part.tsx', 'x')\"",
      "python -c \"open('a.txt','w').write('x')\"",
      "node scripts/check-react-hooks-ratchet.mjs --update",
      "pnpm exec eslint --fix src",
      "npx vitest -u",
      "pnpm test && git commit -am x",
      "pnpm test; rm -rf src",
      "Remove-Item -Recurse dist",
      "echo $(rm -f a.txt)",
    ]) {
      expect(isMutatingShellCommand(cmd), cmd).toBe(true);
    }
  });

  it("reads the call's command argument", () => {
    expect(isMutatingShellCall("run_command", { command: "rm a.ts" })).toBe(true);
    expect(isMutatingShellCall("run_command", { cmd: "pnpm build" })).toBe(false);
    expect(isMutatingShellCall("read_file", { command: "rm a.ts" })).toBe(false);
  });
});
