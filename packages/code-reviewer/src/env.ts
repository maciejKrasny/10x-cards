export const REQUIRED_ENV = [
  "GITHUB_REPOSITORY",
  "PR_NUMBER",
  "BASE_REF",
  "HEAD_REF",
  "OPENROUTER_API_KEY",
  "AI_CR_MODEL",
] as const;

export const DEFAULT_MAX_DIFF_LINES = 3000;

export interface Env {
  ghToken: string;
  repo: string;
  prNumber: string;
  baseRef: string;
  headRef: string;
  openrouterApiKey: string;
  model: string;
  dryRun: boolean;
  maxDiffLines: number;
}

export function parseEnv(source: NodeJS.ProcessEnv, stderr: (s: string) => void): Env | null {
  const missing: string[] = [];
  for (const key of REQUIRED_ENV) {
    if (!source[key] || source[key]?.length === 0) missing.push(key);
  }
  const ghToken = source.GH_TOKEN ?? source.GITHUB_TOKEN ?? "";
  if (ghToken.length === 0) missing.push("GH_TOKEN or GITHUB_TOKEN");
  if (missing.length > 0) {
    stderr(`Missing required environment variable(s): ${missing.join(", ")}\n`);
    return null;
  }
  const maxLinesRaw = source.AI_CR_MAX_DIFF_LINES;
  const maxDiffLines =
    maxLinesRaw !== undefined && maxLinesRaw.length > 0 ? Number.parseInt(maxLinesRaw, 10) : DEFAULT_MAX_DIFF_LINES;
  return {
    ghToken,
    repo: source.GITHUB_REPOSITORY ?? "",
    prNumber: source.PR_NUMBER ?? "",
    baseRef: source.BASE_REF ?? "",
    headRef: source.HEAD_REF ?? "",
    openrouterApiKey: source.OPENROUTER_API_KEY ?? "",
    model: source.AI_CR_MODEL ?? "",
    dryRun: source.AI_CR_DRY_RUN === "1",
    maxDiffLines: Number.isFinite(maxDiffLines) && maxDiffLines > 0 ? maxDiffLines : DEFAULT_MAX_DIFF_LINES,
  };
}
