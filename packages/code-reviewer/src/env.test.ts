import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_DIFF_LINES, DEFAULT_MAX_FINDINGS, parseEnv } from "./env.js";

const BASE = {
  GH_TOKEN: "gh-token",
  GITHUB_REPOSITORY: "owner/repo",
  PR_NUMBER: "42",
  BASE_REF: "main",
  HEAD_REF: "HEAD",
  OPENROUTER_API_KEY: "or-key",
  AI_CR_MODEL: "google/gemma-4-31b-it:free",
};

function captureStderr(): { write: (s: string) => void; text: () => string } {
  const buf: string[] = [];
  return { write: (s) => buf.push(s), text: () => buf.join("") };
}

describe("parseEnv", () => {
  it("returns null and reports every missing required var", () => {
    const { write, text } = captureStderr();
    const env = parseEnv({}, write);
    expect(env).toBeNull();
    expect(text()).toMatch(/GITHUB_REPOSITORY/);
    expect(text()).toMatch(/PR_NUMBER/);
    expect(text()).toMatch(/BASE_REF/);
    expect(text()).toMatch(/HEAD_REF/);
    expect(text()).toMatch(/OPENROUTER_API_KEY/);
    expect(text()).toMatch(/AI_CR_MODEL/);
    expect(text()).toMatch(/GH_TOKEN or GITHUB_TOKEN/);
  });

  it("accepts GITHUB_TOKEN as a fallback for GH_TOKEN", () => {
    const { write } = captureStderr();
    const source: Record<string, string> = { ...BASE, GITHUB_TOKEN: "gh-tok" };
    delete source.GH_TOKEN;
    const env = parseEnv(source, write);
    expect(env).not.toBeNull();
    expect(env?.ghToken).toBe("gh-tok");
  });

  it("prefers GH_TOKEN over GITHUB_TOKEN when both are set", () => {
    const { write } = captureStderr();
    const env = parseEnv({ ...BASE, GITHUB_TOKEN: "gh-tok" }, write);
    expect(env?.ghToken).toBe("gh-token");
  });

  it("treats an empty required var as missing", () => {
    const { write, text } = captureStderr();
    const env = parseEnv({ ...BASE, PR_NUMBER: "" }, write);
    expect(env).toBeNull();
    expect(text()).toMatch(/PR_NUMBER/);
  });

  it("populates Env from source with defaults", () => {
    const { write } = captureStderr();
    const env = parseEnv(BASE, write);
    expect(env).toEqual({
      ghToken: "gh-token",
      repo: "owner/repo",
      prNumber: "42",
      baseRef: "main",
      headRef: "HEAD",
      openrouterApiKey: "or-key",
      model: "google/gemma-4-31b-it:free",
      dryRun: false,
      maxDiffLines: DEFAULT_MAX_DIFF_LINES,
      maxFindings: DEFAULT_MAX_FINDINGS,
      logLevel: "info",
    });
  });

  it("enables dryRun when AI_CR_DRY_RUN is exactly '1'", () => {
    const { write } = captureStderr();
    expect(parseEnv({ ...BASE, AI_CR_DRY_RUN: "1" }, write)?.dryRun).toBe(true);
    expect(parseEnv({ ...BASE, AI_CR_DRY_RUN: "true" }, write)?.dryRun).toBe(false);
    expect(parseEnv({ ...BASE, AI_CR_DRY_RUN: "" }, write)?.dryRun).toBe(false);
  });

  it("parses AI_CR_MAX_DIFF_LINES when set, falls back to default when unset, invalid, or non-positive", () => {
    const { write } = captureStderr();
    expect(parseEnv({ ...BASE, AI_CR_MAX_DIFF_LINES: "500" }, write)?.maxDiffLines).toBe(500);
    expect(parseEnv(BASE, write)?.maxDiffLines).toBe(DEFAULT_MAX_DIFF_LINES);
    expect(parseEnv({ ...BASE, AI_CR_MAX_DIFF_LINES: "abc" }, write)?.maxDiffLines).toBe(DEFAULT_MAX_DIFF_LINES);
    expect(parseEnv({ ...BASE, AI_CR_MAX_DIFF_LINES: "0" }, write)?.maxDiffLines).toBe(DEFAULT_MAX_DIFF_LINES);
    expect(parseEnv({ ...BASE, AI_CR_MAX_DIFF_LINES: "-10" }, write)?.maxDiffLines).toBe(DEFAULT_MAX_DIFF_LINES);
  });

  it("parses AI_CR_MAX_FINDINGS when set, falls back to default when unset, invalid, or non-positive", () => {
    const { write } = captureStderr();
    expect(parseEnv({ ...BASE, AI_CR_MAX_FINDINGS: "5" }, write)?.maxFindings).toBe(5);
    expect(parseEnv(BASE, write)?.maxFindings).toBe(DEFAULT_MAX_FINDINGS);
    expect(parseEnv({ ...BASE, AI_CR_MAX_FINDINGS: "abc" }, write)?.maxFindings).toBe(DEFAULT_MAX_FINDINGS);
    expect(parseEnv({ ...BASE, AI_CR_MAX_FINDINGS: "0" }, write)?.maxFindings).toBe(DEFAULT_MAX_FINDINGS);
    expect(parseEnv({ ...BASE, AI_CR_MAX_FINDINGS: "-3" }, write)?.maxFindings).toBe(DEFAULT_MAX_FINDINGS);
  });

  it("parses AI_CR_LOG_LEVEL, defaults to info, and warns on unknown values", () => {
    const { write } = captureStderr();
    expect(parseEnv({ ...BASE, AI_CR_LOG_LEVEL: "debug" }, write)?.logLevel).toBe("debug");
    expect(parseEnv({ ...BASE, AI_CR_LOG_LEVEL: "info" }, write)?.logLevel).toBe("info");
    expect(parseEnv({ ...BASE, AI_CR_LOG_LEVEL: "warn" }, write)?.logLevel).toBe("warn");
    expect(parseEnv({ ...BASE, AI_CR_LOG_LEVEL: "error" }, write)?.logLevel).toBe("error");
    expect(parseEnv(BASE, write)?.logLevel).toBe("info");
    expect(parseEnv({ ...BASE, AI_CR_LOG_LEVEL: "" }, write)?.logLevel).toBe("info");
    const noisy = captureStderr();
    expect(parseEnv({ ...BASE, AI_CR_LOG_LEVEL: "loud" }, noisy.write)?.logLevel).toBe("info");
    expect(noisy.text()).toMatch(/AI_CR_LOG_LEVEL="loud"/);
  });
});
