import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env.js";
import {
  applyLabels,
  LABEL_FAILED,
  LABEL_PASSED,
  LABEL_RETRY,
  removeRetryLabel,
  verdictLabel,
  type LabelDeps,
} from "./labels.js";

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

function makeDeps(): { deps: LabelDeps; stdout: string[]; ghCalls: { subcmd: string; args: readonly string[] }[] } {
  const stdout: string[] = [];
  const ghCalls: { subcmd: string; args: readonly string[] }[] = [];
  const deps: LabelDeps = {
    stdout: (s) => stdout.push(s),
    runGh: vi.fn((subcmd: string, args: readonly string[]) => {
      ghCalls.push({ subcmd, args });
      return "";
    }),
  };
  return { deps, stdout, ghCalls };
}

describe("applyLabels", () => {
  it("adds the pass verdict label and removes both fail and retry", () => {
    const { deps, ghCalls } = makeDeps();
    applyLabels(deps, makeEnv(), LABEL_PASSED);
    expect(ghCalls).toHaveLength(1);
    const call = ghCalls[0];
    expect(call?.subcmd).toBe("pr");
    expect(call?.args).toContain("edit");
    expect(call?.args).toContain("--add-label");
    expect(call?.args).toContain(LABEL_PASSED);
    expect(call?.args).toContain("--remove-label");
    expect(call?.args).toContain(LABEL_FAILED);
    expect(call?.args).toContain(LABEL_RETRY);
  });

  it("adds the fail verdict label and removes both pass and retry", () => {
    const { deps, ghCalls } = makeDeps();
    applyLabels(deps, makeEnv(), LABEL_FAILED);
    const args = ghCalls[0]?.args ?? [];
    expect(args).toContain(LABEL_FAILED);
    expect(args).toContain(LABEL_PASSED);
    expect(args).toContain(LABEL_RETRY);
  });

  it("does not invoke gh in dry-run and prints the intended command", () => {
    const { deps, ghCalls, stdout } = makeDeps();
    applyLabels(deps, makeEnv({ dryRun: true }), LABEL_PASSED);
    expect(ghCalls).toHaveLength(0);
    expect(stdout.join("")).toMatch(/\[dry-run\] gh pr edit 42/);
    expect(stdout.join("")).toContain("--add-label ai-cr:passed");
    expect(stdout.join("")).toContain("--remove-label ai-cr:failed");
    expect(stdout.join("")).toContain("--remove-label ai-cr:review");
  });
});

describe("removeRetryLabel", () => {
  it("removes only the retry label", () => {
    const { deps, ghCalls } = makeDeps();
    removeRetryLabel(deps, makeEnv());
    expect(ghCalls).toHaveLength(1);
    const args = ghCalls[0]?.args ?? [];
    expect(args).toContain("--remove-label");
    expect(args).toContain(LABEL_RETRY);
    expect(args).not.toContain(LABEL_PASSED);
    expect(args).not.toContain(LABEL_FAILED);
    expect(args).not.toContain("--add-label");
  });

  it("prints the intended command in dry-run and does not invoke gh", () => {
    const { deps, ghCalls, stdout } = makeDeps();
    removeRetryLabel(deps, makeEnv({ dryRun: true }));
    expect(ghCalls).toHaveLength(0);
    expect(stdout.join("")).toMatch(/\[dry-run\] gh pr edit 42/);
    expect(stdout.join("")).toContain("--remove-label ai-cr:review");
  });
});

describe("verdictLabel", () => {
  it("maps pass and fail verdicts to their label constants", () => {
    expect(verdictLabel("pass")).toBe(LABEL_PASSED);
    expect(verdictLabel("fail")).toBe(LABEL_FAILED);
  });
});
