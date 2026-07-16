export const EXCLUDED_PATHS = [
  "package-lock.json",
  "src/db/database.types.ts",
] as const;

export const EXCLUDED_PREFIXES = ["dist/", ".astro/"] as const;

export const EXCLUDED_SUFFIXES = [".snap"] as const;

const MIN_SUFFIX_LENGTH_FOR_MIN = 5;

export function isExcluded(path: string): boolean {
  if ((EXCLUDED_PATHS as readonly string[]).includes(path)) return true;
  if (EXCLUDED_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (EXCLUDED_SUFFIXES.some((s) => path.endsWith(s))) return true;
  return isMinifiedPath(path);
}

function isMinifiedPath(path: string): boolean {
  const lastSlash = path.lastIndexOf("/");
  const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const firstDot = filename.indexOf(".");
  if (firstDot < 0) return false;
  const afterFirstDot = filename.slice(firstDot);
  if (afterFirstDot.length < MIN_SUFFIX_LENGTH_FOR_MIN) return false;
  return afterFirstDot.includes(".min.");
}

interface FileChunk {
  path: string;
  content: string;
  lineCount: number;
}

export function splitDiffByFile(rawDiff: string): FileChunk[] {
  if (rawDiff.length === 0) return [];
  const lines = rawDiff.split("\n");
  const chunks: FileChunk[] = [];
  let currentPath: string | null = null;
  let currentLines: string[] = [];

  const flush = (): void => {
    if (currentPath !== null) {
      const content = currentLines.join("\n");
      chunks.push({ path: currentPath, content, lineCount: currentLines.length });
    }
    currentPath = null;
    currentLines = [];
  };

  const HEADER_PATTERN = /^diff --git a\/(.+) b\/(.+)$/;
  for (const line of lines) {
    const match = HEADER_PATTERN.exec(line);
    if (match) {
      flush();
      currentPath = match[2] ?? match[1] ?? null;
      currentLines = [line];
    } else if (currentPath !== null) {
      currentLines.push(line);
    }
  }
  flush();
  return chunks;
}

export interface ScopedDiff {
  diff: string;
  reviewedFiles: string[];
  skippedFiles: string[];
  truncated: boolean;
}

export function extractTouchedRanges(scopedDiff: string): Map<string, Array<[number, number]>> {
  const result = new Map<string, Array<[number, number]>>();
  if (scopedDiff.length === 0) return result;

  const HEADER_PATTERN = /^diff --git a\/(.+) b\/(.+)$/;
  const HUNK_PATTERN = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

  let currentPath: string | null = null;
  for (const line of scopedDiff.split("\n")) {
    const header = HEADER_PATTERN.exec(line);
    if (header) {
      currentPath = header[2] ?? header[1] ?? null;
      if (currentPath !== null && !result.has(currentPath)) {
        result.set(currentPath, []);
      }
      continue;
    }
    if (currentPath === null) continue;
    const hunk = HUNK_PATTERN.exec(line);
    if (!hunk) continue;
    const start = Number.parseInt(hunk[1] ?? "0", 10);
    const length = hunk[2] === undefined ? 1 : Number.parseInt(hunk[2], 10);
    if (!Number.isFinite(start) || start < 1 || length < 1) continue;
    result.get(currentPath)?.push([start, start + length - 1]);
  }
  return result;
}

export function scopeDiff(rawDiff: string, maxLines = 3000): ScopedDiff {
  const chunks = splitDiffByFile(rawDiff);
  const included: FileChunk[] = [];
  const reviewedFiles: string[] = [];
  const skippedFiles: string[] = [];
  let running = 0;
  let truncated = false;

  for (const chunk of chunks) {
    if (isExcluded(chunk.path)) {
      skippedFiles.push(chunk.path);
      continue;
    }
    if (running + chunk.lineCount > maxLines) {
      truncated = true;
      skippedFiles.push(chunk.path);
      continue;
    }
    included.push(chunk);
    reviewedFiles.push(chunk.path);
    running += chunk.lineCount;
  }

  const diff = included.map((c) => c.content).join("\n");
  return { diff, reviewedFiles, skippedFiles, truncated };
}
