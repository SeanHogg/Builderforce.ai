import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { COPY_PREFIX, materializeBeforeTree } from "./beforeTree";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd });

describe("materializeBeforeTree, copy mode (project code runs in it: the dynamic tier)", () => {
  it("is a real copy OUTSIDE the repository: other inodes, writes never reach the user's files or node_modules caches", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-copytree-"));
    try {
      git(root, "init", "-q");
      fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
      fs.mkdirSync(path.join(root, "src"));
      fs.writeFileSync(path.join(root, "src/a.ts"), "after\n");
      fs.writeFileSync(path.join(root, "package.json"), "{}");
      fs.mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
      fs.writeFileSync(path.join(root, "node_modules/pkg/index.js"), "module.exports = 1;\n");
      fs.mkdirSync(path.join(root, "node_modules/.vite"), { recursive: true });
      fs.writeFileSync(path.join(root, "node_modules/.vite/keep"), "user cache\n");
      fs.mkdirSync(path.join(root, "node_modules/.bin"), { recursive: true });

      const tree = await materializeBeforeTree(root, [{ path: "src/a.ts", text: "before\n" }], undefined, "copy");
      expect(tree).toBeDefined();
      const dir = tree!.dir;
      // Outside the repository, in the OS temp folder (swept at activation by its prefix).
      expect(path.relative(root, dir).startsWith("..")).toBe(true);
      expect(path.basename(dir).startsWith(COPY_PREFIX)).toBe(true);
      expect(path.resolve(path.dirname(dir))).toBe(path.resolve(os.tmpdir()));

      fs.writeFileSync(path.join(root, "keep.ts"), "x\n"); // a file listed after the copy: irrelevant to it
      const copied = path.join(dir, "package.json");
      expect(fs.statSync(copied).ino).not.toBe(fs.statSync(path.join(root, "package.json")).ino);
      fs.writeFileSync(copied, "{\"changed\":true}"); // truncate-and-write in the copy
      expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe("{}");
      expect(fs.readFileSync(path.join(dir, "src/a.ts"), "utf8")).toBe("before\n");

      // A tool's cache folder is the copy's own, empty; a write into it never reaches the user's node_modules.
      const vite = path.join(dir, "node_modules/.vite");
      expect(fs.lstatSync(vite).isSymbolicLink()).toBe(false);
      expect(fs.readdirSync(vite)).toEqual([]);
      fs.writeFileSync(path.join(vite, "x"), "tool output\n");
      expect(fs.readdirSync(path.join(root, "node_modules/.vite"))).toEqual(["keep"]);
      // Installed packages are shared (resolution works as in the working tree).
      expect(fs.readFileSync(path.join(dir, "node_modules/pkg/index.js"), "utf8")).toBe("module.exports = 1;\n");

      await tree!.dispose();
      expect(fs.existsSync(dir)).toBe(false);
      expect(fs.existsSync(path.join(root, "node_modules/pkg/index.js"))).toBe(true); // dispose never walks into it
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
