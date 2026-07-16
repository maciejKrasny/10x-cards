import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCli, type CliDeps } from "./cli.js";
import { CriterionName, type Review, type Verdict } from "./schema.js";

interface ReviewerResult extends Review {
  deterministicVerdict: Verdict;
}

function makeReview(verdict: Verdict): ReviewerResult {
  return {
    criteria: CriterionName.options.map((name) => ({ name, score: verdict === "pass" ? 8 : 3, rationale: "r" })),
    overall: { verdict, summary: "s" },
    findings: [],
    deterministicVerdict: verdict,
  };
}

const BASE_ENV = {
  GH_TOKEN: "gh-token",
  GITHUB_REPOSITORY: "owner/repo",
  PR_NUMBER: "42",
  BASE_REF: "main",
  HEAD_REF: "HEAD",
  OPENROUTER_API_KEY: "or-key",
  AI_CR_MODEL: "google/gemma-4-31b-it:free",
};

function makeDeps(overrides: Partial<CliDeps> = {}): {
  deps: CliDeps;
  stdout: string[];
  stderr: string[];
  ghCalls: { subcmd: string; args: readonly string[] }[];
  gitCalls: { subcmd: string; args: readonly string[] }[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const ghCalls: { subcmd: string; args: readonly string[] }[] = [];
  const gitCalls: { subcmd: string; args: readonly string[] }[] = [];
  const runGh = vi.fn((subcmd: string, args: readonly string[]) => {
    ghCalls.push({ subcmd, args });
    const jqIndex = args.indexOf("--jq");
    if (jqIndex !== -1) {
      const field = args[jqIndex + 1];
      if (field === ".title") return "PR title";
      if (field === ".body") return "PR body";
    }
    return "";
  });
  const runGit = vi.fn((subcmd: string, args: readonly string[]) => {
    gitCalls.push({ subcmd, args });
    if (subcmd === "rev-parse") return "abc1234\n";
    if (subcmd === "diff") return "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+hi\n";
    return "";
  });
  const deps: CliDeps = {
    env: BASE_ENV,
    stdout: (s) => stdout.push(s),
    stderr: (s) => stderr.push(s),
    runGit,
    runGh,
    reviewer: vi.fn().mockResolvedValue(makeReview("pass")),
    now: () => "2026-07-15T12:00:00Z",
    ...overrides,
  };
  return { deps, stdout, stderr, ghCalls, gitCalls };
}

describe("runCli — env validation", () => {
  it("exits 2 and reports missing env when required vars are absent", async () => {
    const { deps, stderr } = makeDeps({ env: {} });
    const code = await runCli(deps);
    expect(code).toBe(2);
    expect(stderr.join("")).toMatch(/Missing required environment variable/);
    expect(stderr.join("")).toMatch(/GITHUB_REPOSITORY/);
    expect(stderr.join("")).toMatch(/OPENROUTER_API_KEY/);
    expect(stderr.join("")).toMatch(/GH_TOKEN or GITHUB_TOKEN/);
  });

  it("accepts GITHUB_TOKEN as a fallback for GH_TOKEN", async () => {
    const env = { ...BASE_ENV };
    delete (env as Partial<typeof env>).GH_TOKEN;
    const { deps } = makeDeps({ env: { ...env, GITHUB_TOKEN: "gh-tok" } });
    const code = await runCli(deps);
    expect(code).toBe(0);
  });
});

describe("runCli — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts a comment via gh pr comment and applies the pass verdict label", async () => {
    const { deps, ghCalls } = makeDeps();
    const code = await runCli(deps);
    expect(code).toBe(0);
    const commentCall = ghCalls.find((c) => c.args[0] === "comment");
    expect(commentCall).toBeDefined();
    expect(commentCall?.args).toContain("--repo");
    expect(commentCall?.args).toContain("owner/repo");
    expect(commentCall?.args).toContain("--body-file");
    const editCall = ghCalls.find((c) => c.args[0] === "edit");
    expect(editCall?.args).toContain("--add-label");
    expect(editCall?.args).toContain("ai-cr:passed");
    expect(editCall?.args).toContain("--remove-label");
    expect(editCall?.args).toContain("ai-cr:failed");
    expect(editCall?.args).toContain("ai-cr:review");
  });

  it("emits ai-cr:failed when the deterministic verdict is fail", async () => {
    const { deps, ghCalls } = makeDeps({ reviewer: vi.fn().mockResolvedValue(makeReview("fail")) });
    await runCli(deps);
    const editCall = ghCalls.find((c) => c.args[0] === "edit");
    expect(editCall?.args).toContain("ai-cr:failed");
    expect(editCall?.args).toContain("ai-cr:passed"); // as remove-label
  });

  it("fetches PR title and body via gh pr view --json", async () => {
    const { deps, ghCalls } = makeDeps();
    await runCli(deps);
    const viewCalls = ghCalls.filter((c) => c.args[0] === "view");
    expect(viewCalls).toHaveLength(2);
    for (const call of viewCalls) {
      expect(call.args).toContain("--repo");
      expect(call.args).toContain("owner/repo");
      expect(call.args).toContain("--json");
    }
  });

  it("invokes git diff between base and head refs", async () => {
    const { deps, gitCalls } = makeDeps();
    await runCli(deps);
    const diff = gitCalls.find((c) => c.subcmd === "diff");
    expect(diff?.args).toEqual(["main...HEAD"]);
  });

  it("passes arguments to gh as an array (never as a shell string)", async () => {
    const { deps, ghCalls } = makeDeps();
    await runCli(deps);
    for (const call of ghCalls) {
      expect(Array.isArray(call.args)).toBe(true);
      for (const arg of call.args) {
        expect(typeof arg).toBe("string");
      }
    }
  });
});

describe("runCli — reviewer failure path", () => {
  it("on reviewer error, posts an unavailable comment, removes the retry label, and exits 0", async () => {
    const { deps, ghCalls } = makeDeps({
      reviewer: vi.fn().mockRejectedValue(new Error("LLM_HTTP_ERROR: upstream 502")),
    });
    const code = await runCli(deps);
    expect(code).toBe(0);
    const commentCall = ghCalls.find((c) => c.args[0] === "comment");
    expect(commentCall).toBeDefined();
    const editCall = ghCalls.find((c) => c.args[0] === "edit");
    expect(editCall?.args).toContain("--remove-label");
    expect(editCall?.args).toContain("ai-cr:review");
    expect(editCall?.args).not.toContain("--add-label");
  });
});

describe("runCli — dry-run", () => {
  it("prints intended gh commands to stdout and does not call runGh for side effects", async () => {
    const { deps, stdout, ghCalls } = makeDeps({ env: { ...BASE_ENV, AI_CR_DRY_RUN: "1" } });
    const code = await runCli(deps);
    expect(code).toBe(0);
    const out = stdout.join("");
    expect(out).toMatch(/\[dry-run\] gh pr comment 42/);
    expect(out).toMatch(/\[dry-run\] gh pr edit 42/);
    expect(out).toMatch(/--add-label ai-cr:passed/);
    expect(out).toMatch(/--remove-label ai-cr:failed/);
    expect(out).toMatch(/--remove-label ai-cr:review/);
    expect(ghCalls).toEqual([]);
  });

  it("does not print the API key or GH token in dry-run output", async () => {
    const { deps, stdout } = makeDeps({ env: { ...BASE_ENV, AI_CR_DRY_RUN: "1" } });
    await runCli(deps);
    const out = stdout.join("");
    expect(out.includes("or-key")).toBe(false);
    expect(out.includes("gh-token")).toBe(false);
  });
});

describe("runCli — structured logging", () => {
  it("emits env_parsed, diff_fetched, and verdict_computed events on the happy path", async () => {
    const { deps, stderr } = makeDeps();
    await runCli(deps);
    const out = stderr.join("");
    expect(out).toContain("event=env_parsed");
    expect(out).toContain("event=diff_fetched");
    expect(out).toContain("event=verdict_computed");
    expect(out).toContain("verdict=pass");
  });

  it("wraps the LLM call in ::group::AI review / ::endgroup::", async () => {
    const { deps, stderr } = makeDeps();
    await runCli(deps);
    const out = stderr.join("");
    expect(out).toContain("::group::AI review");
    expect(out).toContain("::endgroup::");
    expect(out).toContain("event=llm_call_started");
    expect(out).toContain("event=llm_call_finished");
  });

  it("redacts the OpenRouter key and GH token from log output", async () => {
    const { deps, stderr } = makeDeps();
    await runCli(deps);
    const out = stderr.join("");
    expect(out.includes("or-key")).toBe(false);
    expect(out.includes("gh-token")).toBe(false);
  });

  it("emits reviewer_failed with the extracted code on the fail-safe path", async () => {
    const { deps, stderr } = makeDeps({
      reviewer: vi.fn().mockRejectedValue(new Error("LLM_HTTP_ERROR: upstream 502")),
    });
    await runCli(deps);
    const out = stderr.join("");
    expect(out).toContain("event=reviewer_failed");
    expect(out).toContain("code=LLM_HTTP_ERROR");
  });
});
