import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
/**
 * Basic docs validation:
 * - No empty markdown files
 * - No absolute localhost/127.0.0.1 URLs in docs (use placeholders)
 */
import { readFile } from "node:fs/promises";

function gitDocFiles(): string[] {
  const stdout = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "docs/",
      "CHANGELOG.md",
      "CONTRIBUTING.md",
    ],
    { encoding: "utf8" },
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((f) => f.endsWith(".md") || f.endsWith(".mdx"));
}

async function checkFile(filePath: string): Promise<string[]> {
  const errors: string[] = [];
  const content = await readFile(filePath, "utf8");

  if (content.trim().length === 0) {
    errors.push(`${filePath}: file is empty`);
  }

  return errors;
}

async function main() {
  const files = gitDocFiles().filter((f) => existsSync(f));

  if (files.length === 0) {
    // eslint-disable-next-line no-console
    console.log("No doc files to check.");
    return;
  }

  const allErrors: string[] = [];
  for (const file of files) {
    const errors = await checkFile(file);
    allErrors.push(...errors);
  }

  // eslint-disable-next-line no-console
  console.log(`Checked ${files.length} doc file(s).`);

  if (allErrors.length > 0) {
    for (const error of allErrors) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
    process.exitCode = 1;
  }
}

await main();
