import { describe, expect, it } from "vitest";
import { buildPrompt, CRITERION_NAMES_IN_PROMPT } from "./prompt.js";
import { CriterionName } from "./schema.js";

describe("buildPrompt", () => {
  it("includes every criterion name verbatim in the system prompt", () => {
    const { system } = buildPrompt({ title: "t", description: "d", diff: "x" });
    for (const name of CriterionName.options) {
      expect(system.includes(name)).toBe(true);
    }
  });

  it("re-exports the criterion names in the same order as the schema", () => {
    expect(CRITERION_NAMES_IN_PROMPT).toEqual([...CriterionName.options]);
  });

  it("includes PR title, description, and diff in the user prompt", () => {
    const { prompt } = buildPrompt({
      title: "Add feature X",
      description: "Motivation here",
      diff: "diff --git a/x b/x\n",
    });
    expect(prompt.includes("Add feature X")).toBe(true);
    expect(prompt.includes("Motivation here")).toBe(true);
    expect(prompt.includes("diff --git")).toBe(true);
    expect(prompt.includes("---DIFF---")).toBe(true);
  });

  it("substitutes a placeholder when description is empty", () => {
    const { prompt } = buildPrompt({ title: "t", description: "", diff: "d" });
    expect(prompt.includes("(no description provided)")).toBe(true);
  });

  it("appends the truncation note when supplied", () => {
    const { prompt } = buildPrompt({
      title: "t",
      description: "d",
      diff: "x",
      truncationNote: "3 of 8 files reviewed",
    });
    expect(prompt.includes("3 of 8 files reviewed")).toBe(true);
  });

  it("omits the truncation note when not supplied or empty", () => {
    const withoutNote = buildPrompt({ title: "t", description: "d", diff: "x" });
    const withEmptyNote = buildPrompt({ title: "t", description: "d", diff: "x", truncationNote: "" });
    expect(withoutNote.prompt.includes("Note:")).toBe(false);
    expect(withEmptyNote.prompt.includes("Note:")).toBe(false);
  });
});
