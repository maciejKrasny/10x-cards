#!/usr/bin/env -S npx tsx
/**
 * Env-var rollout gate. Fails the PR when a diff introduces a new env-var
 * declaration in astro.config.mjs (env.schema) or a new `from "astro:env/server"`
 * import, unless some open `context/changes/*\/plan.md` carries an acknowledgement
 * — either a Progress checkbox for setting the secret in Workers, or an explicit
 * "no production env vars" prose line.
 *
 * Background: context/foundation/lessons.md — "Production env-var rollout needs
 * a Progress checkbox, not prose" (S-01 incident).
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const FAILURE_MESSAGE =
  "Env-var rollout gate: the PR touches env declarations/usage but no open plan.md " +
  "under context/changes/ contains the required Progress checkbox OR an explicit " +
  "'no production env vars' acknowledgement. See context/foundation/lessons.md " +
  "(Production env-var rollout).";

const ASTRO_CONFIG = "astro.config.mjs";

function resolveBaseRef(): string {
  const ciBase = process.env.GITHUB_BASE_REF;
  if (ciBase && ciBase.length > 0) return `origin/${ciBase}`;
  return "origin/main";
}

function getDiff(baseRef: string): string {
  try {
    return execSync(`git diff --unified=0 ${baseRef}...HEAD`, { encoding: "utf8" });
  } catch {
    return execSync(`git diff --unified=0 HEAD`, { encoding: "utf8" });
  }
}

interface DiffHunk {
  file: string;
  addedLineNumbers: number[];
  addedLines: { lineNumber: number; content: string }[];
}

function parseDiff(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentFile = "";
  let currentNewLine = 0;
  let current: DiffHunk | undefined;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = / b\/(.+)$/.exec(line);
      currentFile = match ? match[1] : "";
      current = { file: currentFile, addedLineNumbers: [], addedLines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("@@")) {
      const m = /\+(\d+)(?:,\d+)?/.exec(line);
      if (m) currentNewLine = parseInt(m[1], 10);
      continue;
    }
    if (line.startsWith("+")) {
      current.addedLineNumbers.push(currentNewLine);
      current.addedLines.push({ lineNumber: currentNewLine, content: line.slice(1) });
      currentNewLine++;
    } else if (line.startsWith("-")) {
      // deletion — does not advance new-side counter
    } else {
      currentNewLine++;
    }
  }
  return hunks.filter((h) => h.file.length > 0);
}

function envSchemaBlockRange(filePath: string): [number, number] | null {
  if (!existsSync(filePath)) return null;
  const lines = readFileSync(filePath, "utf8").split("\n");
  let start = -1;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (start < 0) {
      if (/\benv\s*:\s*\{/.test(text)) {
        start = i + 1;
        depth = (text.match(/\{/g) ?? []).length - (text.match(/\}/g) ?? []).length;
      }
      continue;
    }
    depth += (text.match(/\{/g) ?? []).length;
    depth -= (text.match(/\}/g) ?? []).length;
    if (depth <= 0) return [start, i + 1];
  }
  return null;
}

function diffTriggersEnvGate(diffText: string): boolean {
  const hunks = parseDiff(diffText);

  const astroHunks = hunks.filter((h) => h.file === ASTRO_CONFIG);
  if (astroHunks.length > 0) {
    const range = envSchemaBlockRange(ASTRO_CONFIG);
    if (range) {
      const [from, to] = range;
      for (const h of astroHunks) {
        if (h.addedLineNumbers.some((n) => n >= from && n <= to)) return true;
      }
    }
  }

  const importPattern = /^\+(?!\+\+).*from\s+["']astro:env\/server["']/;
  for (const h of hunks) {
    for (const added of h.addedLines) {
      if (importPattern.test("+" + added.content)) return true;
    }
  }

  return false;
}

function planAcknowledgesRollout(): boolean {
  const changesDir = "context/changes";
  if (!existsSync(changesDir)) return false;

  const ackPattern = /no production env vars (to add|introduced)/i;
  const checkboxPattern = /^\s*- \[[ x]\]\s+.*secret.*(set|put).*(workers|environment|wrangler)/im;

  for (const entry of readdirSync(changesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const planPath = join(changesDir, entry.name, "plan.md");
    if (!existsSync(planPath)) continue;
    if (!statSync(planPath).isFile()) continue;

    const text = readFileSync(planPath, "utf8");
    if (ackPattern.test(text)) return true;

    const progressIdx = text.indexOf("## Progress");
    if (progressIdx >= 0) {
      const progressBody = text.slice(progressIdx);
      if (checkboxPattern.test(progressBody)) return true;
    }
  }
  return false;
}

function main(): void {
  const baseRef = resolveBaseRef();
  const diffText = getDiff(baseRef);

  if (!diffTriggersEnvGate(diffText)) {
    process.exit(0);
  }

  if (planAcknowledgesRollout()) {
    process.exit(0);
  }

  // eslint-disable-next-line no-console -- CLI gate writes a failure reason to stderr
  console.error(FAILURE_MESSAGE);
  process.exit(1);
}

main();
