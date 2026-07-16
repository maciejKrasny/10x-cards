import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env.js";
import { fetchPRField, postComment, type GhDeps } from "./gh.js";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ghToken: "gh-token",
    repo: "owner/repo",
    prNumber: "42",
    baseRef: "main",
    headRef: "HEAD",
    openrouterApiKey: "or-key",
    model: "m",
    dryRun: false,
    maxDiffLines: 3000,
    ...overrides,
  };
}

function makeDeps(): {
  deps: GhDeps;
  stdout: string[];
  ghCalls: { subcmd: string; args: readonly string[] }[];
} {
  const stdout: string[] = [];
  const ghCalls: { subcmd: string; args: readonly string[] }[] = [];
  const deps: GhDeps = {
    stdout: (s) => stdout.push(s),
    runGh: vi.fn((subcmd: string, args: readonly string[]) => {
      ghCalls.push({ subcmd, args });
      return "";
    }),
  };
  return { deps, stdout, ghCalls };
}

describe("fetchPRField", () => {
  it("invokes gh pr view --json <field> --jq .<field> and trims the result", () => {
    const runGh = vi.fn((_subcmd: string, args: readonly string[]) => {
      const jqIdx = args.indexOf("--jq");
      const field = args[jqIdx + 1];
      if (field === ".title") return "  PR title  \n";
      if (field === ".body") return "PR body";
      return "";
    });
    expect(fetchPRField(runGh, makeEnv(), "title")).toBe("PR title");
    expect(fetchPRField(runGh, makeEnv(), "body")).toBe("PR body");
    const call = runGh.mock.calls[0];
    expect(call?.[0]).toBe("pr");
    expect(call?.[1]).toContain("view");
    expect(call?.[1]).toContain("--repo");
    expect(call?.[1]).toContain("owner/repo");
    expect(call?.[1]).toContain("--json");
    expect(call?.[1]).toContain("title");
  });
});

describe("postComment", () => {
  it("writes the markdown to a tempfile and invokes gh pr comment --body-file", () => {
    const { deps, ghCalls } = makeDeps();
    const body = "## Hello\n\nContent";
    postComment(deps, makeEnv(), body);
    expect(ghCalls).toHaveLength(1);
    const args = ghCalls[0]?.args ?? [];
    expect(args[0]).toBe("comment");
    expect(args).toContain("--body-file");
    const bodyFileIdx = args.indexOf("--body-file");
    const bodyFilePath = args[bodyFileIdx + 1];
    expect(typeof bodyFilePath).toBe("string");
    if (typeof bodyFilePath === "string") {
      const written = readFileSync(bodyFilePath, "utf8");
      expect(written).toBe(body);
    }
  });

  it("does not invoke gh in dry-run and prints the markdown body between markers", () => {
    const { deps, ghCalls, stdout } = makeDeps();
    postComment(deps, makeEnv({ dryRun: true }), "hello");
    expect(ghCalls).toHaveLength(0);
    const out = stdout.join("");
    expect(out).toMatch(/\[dry-run\] gh pr comment 42/);
    expect(out).toContain("--- comment body ---");
    expect(out).toContain("hello");
    expect(out).toContain("--- end body ---");
  });
});
