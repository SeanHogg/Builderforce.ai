import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { syncedRepositoryIdentity } from "./repoIdentity";

const localOf = (posix: string): string => `local:${createHash("sha256").update(posix).digest("hex").slice(0, 16)}`;

describe("syncedRepositoryIdentity", () => {
  it("regression: drops the userinfo, query and fragment of an http(s) remote", () => {
    expect(syncedRepositoryIdentity("https://x-access-token:ghp_secret123@github.com/org/repo.git"))
      .toBe("https://github.com/org/repo.git");
    expect(syncedRepositoryIdentity("https://ci:pass@git.example.test:8443/org/repo.git?private_token=abc#readme"))
      .toBe("https://git.example.test:8443/org/repo.git");
    expect(syncedRepositoryIdentity("HTTP://user@host.example/org/repo")).toBe("http://host.example/org/repo");
  });

  it("keeps a plain remote as it is", () => {
    expect(syncedRepositoryIdentity("https://github.com/acme/repo.git")).toBe("https://github.com/acme/repo.git");
    expect(syncedRepositoryIdentity("ssh://github.com/acme/repo.git")).toBe("ssh://github.com/acme/repo.git");
  });

  it("regression: drops the user (and password) of an ssh remote", () => {
    expect(syncedRepositoryIdentity("ssh://git:hunter2@github.com:22/org/repo.git")).toBe("ssh://github.com:22/org/repo.git");
    expect(syncedRepositoryIdentity("git+ssh://deploy@host.example/org/repo.git")).toBe("git+ssh://host.example/org/repo.git");
  });

  it("regression: normalises an scp-style remote to ssh:// without its user", () => {
    expect(syncedRepositoryIdentity("git@github.com:org/repo.git")).toBe("ssh://github.com/org/repo.git");
    expect(syncedRepositoryIdentity("github.com:org/repo.git")).toBe("ssh://github.com/org/repo.git");
    expect(syncedRepositoryIdentity("deploy:token@host.example:org/repo.git")).not.toContain("token");
  });

  it("regression: hashes a file:// remote, a Windows path, an absolute and a relative path", () => {
    const fileUrl = syncedRepositoryIdentity("file:///home/me/secret-project/repo.git");
    expect(fileUrl).toMatch(/^local:[0-9a-f]{16}$/);
    expect(fileUrl).toBe(localOf("file:///home/me/secret-project/repo.git"));
    // The same hash `run-delta` records have always used for a root (backslashes as slashes).
    expect(syncedRepositoryIdentity("C:\\work\\repo")).toBe(localOf("C:/work/repo"));
    expect(syncedRepositoryIdentity("C:/work/repo")).toBe(localOf("C:/work/repo"));
    expect(syncedRepositoryIdentity("/home/me/repo")).toBe(localOf("/home/me/repo"));
    expect(syncedRepositoryIdentity("../sibling/repo")).toMatch(/^local:[0-9a-f]{16}$/);
    expect(syncedRepositoryIdentity("ssh:///no-host")).toMatch(/^local:[0-9a-f]{16}$/);
  });

  it("is idempotent", () => {
    for (const repo of [
      "https://x-access-token:ghp_secret123@github.com/org/repo.git",
      "ssh://git@github.com/org/repo.git",
      "git@github.com:org/repo.git",
      "file:///home/me/repo",
      "C:\\work\\repo",
      "/home/me/repo",
    ]) {
      const once = syncedRepositoryIdentity(repo);
      expect(syncedRepositoryIdentity(once)).toBe(once);
    }
  });
});
