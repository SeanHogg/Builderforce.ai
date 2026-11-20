import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHIP_POLICY,
  REPO_PUBLISH_TOOLS,
  SHIP_MODES,
  narrowByHold,
  narrowShipPolicy,
  publishAllowed,
  publishVerbOf,
  shipDirective,
  shipNudge,
  shipPolicyOf,
  type PublishVerb,
  type ShipMode,
} from "./shipPolicy.js";
import { PUBLISH_TOOLS } from "./inRunVerify.js";

const run = (command: string) => ({ command });

/** One call per verb: the tool, and the raw shell form. */
const CALLS: ReadonlyArray<readonly [string, unknown, PublishVerb]> = [
  ["git_commit", { paths: ["a.ts"], allowBaseBranch: true }, "commit"],
  ["run_command", run("git -C Builderforce.ai commit -m x"), "commit"],
  ["git_push", { allowBaseBranch: true }, "push"],
  ["run_command", run("git push origin main"), "push"],
  ["open_pull_request", { title: "t" }, "pull_request"],
  ["run_command", run("gh pr create --fill"), "pull_request"],
  ["git_cleanup_merged", { branch: "feat/x" }, "cleanup"],
  // Runs never merge: no mode below allows it.
  ["run_command", run("gh pr merge 12 --squash"), "merge"],
];

/** Which verbs each mode allows for those (base-branch) calls. */
const ALLOWED: Readonly<Record<ShipMode, ReadonlySet<PublishVerb>>> = {
  leave_uncommitted: new Set(),
  commit: new Set(["commit"]),
  commit_push: new Set(["commit", "push", "cleanup"]),
  // The pushes above target the base branch; a cleanup does not push it.
  pull_request: new Set(["commit", "pull_request", "cleanup"]),
};

describe("publishVerbOf — THE publish matcher", () => {
  it("names each publish tool and the raw shell forms", () => {
    for (const [tool, args, verb] of CALLS) expect(publishVerbOf(tool, args), `${tool} ${JSON.stringify(args)}`).toBe(verb);
  });

  it("reads `cmd` as well as `command`, and gh's own flags before the subcommand", () => {
    expect(publishVerbOf("run_command", { cmd: "git push" })).toBe("push");
    expect(publishVerbOf("run_command", run("gh --repo acme/app pr create --title x"))).toBe("pull_request");
    expect(publishVerbOf("run_command", run("gh -R acme/app pr create"))).toBe("pull_request");
  });

  it("names the widest verb of a chained command", () => {
    expect(publishVerbOf("run_command", run("git commit -am x && git push"))).toBe("push");
  });

  it("is null for reads, status, a build and other gh subcommands", () => {
    for (const [tool, args] of [
      ["git_status", {}],
      ["git_diff", {}],
      ["run_command", run("pnpm --filter builderforce-api type-check")],
      ["run_command", run("gh pr view 12")],
      ["run_command", run("git log --oneline")],
      ["read_file", { path: "commit.ts" }],
    ] as const) {
      expect(publishVerbOf(tool, args), tool).toBeNull();
    }
  });

  it("REPO_PUBLISH_TOOLS is PUBLISH_TOOLS plus git_cleanup_merged — one list", () => {
    expect([...REPO_PUBLISH_TOOLS].sort()).toEqual([...PUBLISH_TOOLS, "git_cleanup_merged"].sort());
  });
});

describe("publishAllowed — every mode × verb", () => {
  for (const mode of SHIP_MODES) {
    it(`${mode}`, () => {
      const policy = shipPolicyOf(mode, "project_settings");
      for (const [tool, args, verb] of CALLS) {
        const verdict = publishAllowed(policy, tool, args);
        expect(verdict.ok, `${mode} ${tool} ${JSON.stringify(args)}`).toBe(ALLOWED[mode].has(verb));
        if (!verdict.ok) {
          expect(verdict.error).toContain(mode);
          expect(verdict.error).toContain("the project's settings");
        }
      }
    });
  }

  it("a raw gh pr create is refused under leave_uncommitted, commit and commit_push", () => {
    for (const mode of ["leave_uncommitted", "commit", "commit_push"] as const) {
      expect(publishAllowed(shipPolicyOf(mode, "project_settings"), "run_command", run("gh pr create --fill")).ok, mode).toBe(false);
    }
    expect(publishAllowed(shipPolicyOf("pull_request", "project_settings"), "run_command", run("gh pr create --fill")).ok).toBe(true);
  });

  it("pull_request allows a branch push and refuses the base branch", () => {
    const pr = shipPolicyOf("pull_request", "project_settings");
    expect(publishAllowed(pr, "git_push", {}).ok).toBe(true);
    expect(publishAllowed(pr, "git_push", { allowBaseBranch: true }).ok).toBe(false);
    expect(publishAllowed(pr, "run_command", run("git push -u origin feat/ship-policy")).ok).toBe(true);
    expect(publishAllowed(pr, "run_command", run("git push origin HEAD:main")).ok).toBe(false);
    // No refspec: it pushes whatever is checked out, which may be the base — refused, not guessed.
    expect(publishAllowed(pr, "run_command", run("git push")).ok).toBe(false);
  });

  it("anything that is not a publish is allowed under every mode", () => {
    for (const mode of SHIP_MODES) expect(publishAllowed(shipPolicyOf(mode, "default"), "edit_file", { path: "a.ts" }).ok).toBe(true);
  });

  it("a hold's refusal quotes the turn that set it", () => {
    const held = narrowByHold(DEFAULT_SHIP_POLICY, { messageNumber: 3, text: "don't commit until I check" });
    const verdict = publishAllowed(held, "git_commit", { paths: ["a.ts"] });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain("message #3");
  });
});

describe("narrowShipPolicy — a narrower can only take away", () => {
  // The base is the project's policy; the narrower is a distinct source so the test sees which one won.
  const user = (mode: ShipMode) => shipPolicyOf(mode, "project_settings");
  const workspace = (mode: ShipMode) => shipPolicyOf(mode, "subagent");

  it("a stricter value narrows, and names itself as the source", () => {
    expect(narrowShipPolicy(user("commit_push"), workspace("leave_uncommitted"))).toEqual(workspace("leave_uncommitted"));
    expect(narrowShipPolicy(user("commit_push"), workspace("commit"))).toEqual(workspace("commit"));
    expect(narrowShipPolicy(user("commit_push"), workspace("pull_request"))).toEqual(workspace("pull_request"));
  });

  it("a looser value cannot widen", () => {
    expect(narrowShipPolicy(user("commit"), workspace("commit_push"))).toEqual(user("commit"));
    expect(narrowShipPolicy(user("leave_uncommitted"), workspace("pull_request"))).toEqual(user("leave_uncommitted"));
    expect(narrowShipPolicy(user("pull_request"), workspace("commit_push"))).toEqual(user("pull_request"));
  });

  it("null leaves it as it is", () => {
    expect(narrowShipPolicy(user("commit"), null)).toEqual(user("commit"));
  });

  it("same mode: the stricter merge and review hold", () => {
    const loose = { ...shipPolicyOf("pull_request", "project_settings"), merge: "immediate" as const };
    const strict = { ...shipPolicyOf("pull_request", "subagent"), merge: "never" as const, review: "required" as const };
    expect(narrowShipPolicy(loose, strict)).toMatchObject({ merge: "never", review: "required", source: "subagent" });
    expect(narrowShipPolicy(strict, loose)).toEqual(strict);
  });
});

describe("narrowByHold", () => {
  it("narrows any policy to leave_uncommitted, carrying the hold", () => {
    for (const mode of SHIP_MODES) {
      const held = narrowByHold(shipPolicyOf(mode, "project_settings"), { messageNumber: 2, text: "keep it local" });
      expect(held).toMatchObject({ mode: "leave_uncommitted", source: "chat_hold", hold: { messageNumber: 2 } });
    }
  });

  it("no hold leaves the policy; a sub-agent keeps its own source", () => {
    expect(narrowByHold(DEFAULT_SHIP_POLICY, null)).toBe(DEFAULT_SHIP_POLICY);
    const child = shipPolicyOf("leave_uncommitted", "subagent");
    expect(narrowByHold(child, { messageNumber: 1, text: "don't push" })).toBe(child);
  });
});

describe("shipDirective / shipNudge", () => {
  it("never asks, never says publishes are shown for approval, and the author does not record its own complete review", () => {
    for (const mode of SHIP_MODES) {
      const d = shipDirective(shipPolicyOf(mode, "project_settings"), { chatId: 103 });
      expect(d, mode).toMatch(/never ask the person whether to commit, push or open a pull request/);
      expect(d, mode).not.toMatch(/shown to the human for approval/);
      expect(d, mode).not.toMatch(/YOU are its reviewer/);
      expect(d, mode).toContain(`\`${mode}\``);
    }
    const d = shipDirective(DEFAULT_SHIP_POLICY, { chatId: 103 });
    expect(d).toMatch(/Do NOT record builtin_reviews_record with verdict "complete" yourself/);
    expect(d).toContain("chatId=103");
  });

  it("keeps verify → self-review → ship → close → final report, in that order", () => {
    const d = shipDirective(shipPolicyOf("commit_push", "project_settings"));
    const order = ["VERIFY", "SELF-REVIEW", "SHIP", "CLOSE", "FINAL REPORT"].map((w) => d.indexOf(`${w} —`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(d).toContain("git_push` with allowBaseBranch:true");
  });

  it("states the ship step by mode", () => {
    expect(shipDirective(shipPolicyOf("commit", "project_settings"))).toMatch(/Do NOT push/);
    expect(shipDirective(shipPolicyOf("pull_request", "project_settings"))).toMatch(/open_pull_request`\. Never push the base branch and never merge — A human merges it\./);
    const leave = shipDirective(shipPolicyOf("leave_uncommitted", "subagent"));
    expect(leave).toMatch(/Do NOT run git_commit, git_push, open_pull_request/);
    expect(leave).toMatch(/You are a sub-agent/);
  });

  it("the default says the project's policy is unset and where to set it — never a VS Code setting", () => {
    const d = shipDirective(DEFAULT_SHIP_POLICY);
    expect(d).toMatch(/The project's ship policy is unset — set it .* in the project's settings, or ask me to set it/);
    expect(d).not.toMatch(/builderforce\.shipPolicy|VS Code/);
    expect(shipDirective(shipPolicyOf("commit", "project_settings"))).not.toMatch(/ship policy is unset/);
  });

  it("the nudge is null when the mode ships nothing, and names what is left otherwise", () => {
    expect(shipNudge(shipPolicyOf("leave_uncommitted", "project_settings"))).toBeNull();
    const n = shipNudge(shipPolicyOf("commit_push", "project_settings"));
    expect(n).toMatch(/changed code/);
    expect(n).toContain("git_commit");
    expect(n).toContain("git_push");
    expect(n).not.toMatch(/zero tool calls/);
    expect(shipNudge(DEFAULT_SHIP_POLICY)).toMatch(/do not push/);
  });
});

describe("gh pr merge / gh pr new", () => {
  it("`gh pr new` is an alias of `gh pr create`", () => {
    expect(publishVerbOf("run_command", run("gh pr new --fill"))).toBe("pull_request");
    expect(publishVerbOf("run_command", run("gh -R acme/app pr new"))).toBe("pull_request");
  });

  it("`gh pr merge` is a merge, refused in EVERY mode with the sweep named", () => {
    expect(publishVerbOf("run_command", run("gh --repo acme/app pr merge 7 --auto"))).toBe("merge");
    for (const mode of SHIP_MODES) {
      const verdict = publishAllowed(shipPolicyOf(mode, "project_settings"), "run_command", run("gh pr merge 7"));
      expect(verdict.ok, mode).toBe(false);
      if (!verdict.ok) expect(verdict.error).toContain("merge sweep");
    }
  });
});

describe("pull_request — a push that may land on the base branch is refused", () => {
  const pr = shipPolicyOf("pull_request", "project_settings");
  const push = (command: string) => publishAllowed(pr, "run_command", run(command)).ok;

  it("refuses a bare HEAD or @ destination (it pushes whatever is checked out)", () => {
    expect(push("git push origin HEAD")).toBe(false);
    expect(push("git push -u origin HEAD")).toBe(false);
    expect(push("git push origin @")).toBe(false);
    expect(push("git push --force-with-lease origin +HEAD")).toBe(false);
  });

  it("refuses no refspec, and a refspec whose destination is main/master", () => {
    expect(push("git push")).toBe(false);
    expect(push("git push origin")).toBe(false);
    expect(push("git push origin main")).toBe(false);
    expect(push("git push origin HEAD:main")).toBe(false);
    expect(push("git push origin feat/x:refs/heads/master")).toBe(false);
  });

  it("skips the values of value-taking flags when finding operands", () => {
    // Without skipping, `ci.skip` would read as the remote and `origin` as the refspec.
    expect(push("git push -o ci.skip origin")).toBe(false);
    expect(push("git push --push-option ci.skip origin main")).toBe(false);
    expect(push("git push --repo origin HEAD")).toBe(false);
    expect(push("git push --receive-pack /usr/bin/git-receive-pack origin")).toBe(false);
    expect(push("git push -o ci.skip origin feat/x")).toBe(true);
    expect(push("git push --receive-pack x origin feat/x")).toBe(true);
  });

  it("allows a push of a named branch, including HEAD:<branch>", () => {
    expect(push("git push origin feat/x")).toBe(true);
    expect(push("git push -u origin HEAD:feat/x")).toBe(true);
  });
});

describe("merge through the provider API is a merge, refused in every mode", () => {
  const merges = [
    "gh api -X PUT repos/acme/app/pulls/12/merge",
    "gh api --method PUT /repos/acme/app/pulls/12/merge -f merge_method=squash",
    "curl -X PUT -H 'Authorization: token x' https://api.github.com/repos/acme/app/pulls/12/merge",
    "wget --method=PUT https://api.github.com/repos/acme/app/pulls/12/merge",
    "curl -X PUT https://gitlab.com/api/v4/projects/7/merge_requests/3/merge",
  ];
  it.each(merges)("%s", (command) => {
    expect(publishVerbOf("run_command", run(command))).toBe("merge");
    for (const mode of SHIP_MODES) {
      for (const host of ["editor", "cloud"] as const) {
        expect(publishAllowed(shipPolicyOf(mode, "project_settings"), "run_command", run(command), host).ok, `${mode}/${host}`).toBe(false);
      }
    }
  });

  it("a read of the pull request is not a merge", () => {
    expect(publishVerbOf("run_command", run("gh api repos/acme/app/pulls/12"))).toBeNull();
    expect(publishVerbOf("run_command", run("curl https://api.github.com/repos/acme/app/pulls/12/files"))).toBeNull();
  });
});

describe("editor pull_request — shell quoting cannot hide the base branch", () => {
  const pr = shipPolicyOf("pull_request", "project_settings");
  const push = (command: string) => publishAllowed(pr, "run_command", run(command)).ok;

  it("refuses quoted, bash -c and $() forms of a push to main", () => {
    expect(push("git push origin 'main'")).toBe(false);
    expect(push('git push origin "main"')).toBe(false);
    expect(push('bash -c "git push origin main"')).toBe(false);
    expect(push("echo $(git push origin main)")).toBe(false);
    expect(push("git push origin \"HEAD:main\"")).toBe(false);
  });

  it("refuses a destination the shell would still expand", () => {
    expect(push("git push origin $BRANCH")).toBe(false);
  });

  it("still allows a quoted named branch", () => {
    expect(push("git push origin 'feat/x'")).toBe(true);
    expect(push('bash -c "git push -u origin feat/x"')).toBe(true);
  });
});

describe("cloud host — every raw shell push, PR and merge is refused", () => {
  const cloud = shipPolicyOf("pull_request", "project_settings");
  const ok = (command: string) => publishAllowed(cloud, "run_command", run(command), "cloud").ok;

  it.each([
    "git push origin feat/x",
    "git push origin develop",
    "git push origin trunk",
    "git push origin 'main'",
    'bash -c "git push origin main"',
    "echo $(git push origin main)",
    "gh pr create --fill",
    "gh pr new",
    "gh pr merge 3",
    "gh api -X PUT repos/acme/app/pulls/3/merge",
  ])("%s", (command) => {
    expect(ok(command)).toBe(false);
  });

  it("a non-publishing command still runs", () => {
    expect(ok("pnpm test")).toBe(true);
    expect(ok("git status")).toBe(true);
  });
});

describe("source: 'person_grant' — PRD 48 §4.6, a person granted this run's merge into main", () => {
  const granted = { ...shipPolicyOf("pull_request", "person_grant"), merge: "on_green" as const };

  it("the cloud directive says a person authorized the merge, the platform merges on green, and the run never merges or pushes", () => {
    const d = shipDirective(granted, { host: "cloud" });
    expect(d).toContain("A person authorized merging this pull request into main: the platform merges it once the security scan and CI pass.");
    expect(d).toContain("Never merge or push the base branch yourself.");
    expect(d).toContain("set by a person's merge grant for this run");
    expect(d).not.toContain("merge sweep merges it once CI is green");
  });

  it("the grant does not loosen the gate: a raw push or a merge is still refused", () => {
    expect(publishAllowed(granted, "run_command", run("git push origin main"), "cloud").ok).toBe(false);
    expect(publishAllowed(granted, "run_command", run("gh pr merge 3"), "cloud").ok).toBe(false);
  });
});

describe("host: 'cloud' — the platform opens the pull request, so no git tools are named", () => {
  const cloud = { ...shipPolicyOf("pull_request", "project_settings"), merge: "on_green" as const, review: "required" as const };

  it("the directive's ship step names no git tools and states the merge and review", () => {
    const d = shipDirective(cloud, { host: "cloud" });
    expect(d).toContain("your changes on the run branch are the deliverable; when the run ends the platform opens the pull request");
    expect(d).toContain("Never push or merge the base branch");
    expect(d).toContain("The project's merge sweep merges it once CI is green.");
    expect(d).toContain("An independent review or sign-off must be recorded before it merges.");
    for (const tool of ["git_commit", "git_push", "open_pull_request", "git_diff"]) expect(d, tool).not.toContain(tool);
  });

  it("a human merges when the project withholds merge authority", () => {
    expect(shipDirective({ ...cloud, merge: "never", review: "none" }, { host: "cloud" })).toContain("A human merges it.");
  });

  it("the default host is the editor, unchanged", () => {
    expect(shipDirective(cloud)).toBe(shipDirective(cloud, { host: "editor" }));
    expect(shipDirective(cloud)).toContain("open_pull_request");
  });

  it("the nudge and the refusal name no git tools on the cloud host", () => {
    const n = shipNudge(cloud, "cloud")!;
    expect(n).toContain("the platform opens the pull request");
    for (const tool of ["git_commit", "git_push", "open_pull_request"]) expect(n, tool).not.toContain(tool);
    const verdict = publishAllowed(cloud, "run_command", run("git push origin main"), "cloud");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.error).toContain("the platform opens the pull request when it ends");
      expect(verdict.error).not.toContain("open_pull_request");
    }
  });
});
