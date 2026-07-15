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
