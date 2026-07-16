import { describe, expect, it } from "vitest";
import { createLogger, type LogLevel } from "./logger.js";

function capture(): { write: (s: string) => void; lines: () => string[]; text: () => string } {
  const buf: string[] = [];
  return {
    write: (s) => buf.push(s),
    lines: () => buf.join("").split("\n").filter((l) => l.length > 0),
    text: () => buf.join(""),
  };
}

describe("createLogger — level filtering", () => {
  it("suppresses debug lines at the default info level", () => {
    const { write, lines } = capture();
    const log = createLogger({ write });
    log.debug("skipped");
    log.info("kept");
    expect(lines()).toEqual(["level=info event=kept"]);
  });

  it("emits every level at debug", () => {
    const { write, lines } = capture();
    const log = createLogger({ level: "debug", write });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines()).toEqual([
      "level=debug event=d",
      "level=info event=i",
      "level=warn event=w",
      "level=error event=e",
    ]);
  });

  it("respects each threshold in turn", () => {
    for (const [level, keptEvents] of [
      ["debug", ["d", "i", "w", "e"]],
      ["info", ["i", "w", "e"]],
      ["warn", ["w", "e"]],
      ["error", ["e"]],
    ] as [LogLevel, string[]][]) {
      const { write, lines } = capture();
      const log = createLogger({ level, write });
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
      expect(lines().map((l) => l.split("event=")[1])).toEqual(keptEvents);
    }
  });
});

describe("createLogger — redaction", () => {
  it("replaces every occurrence of each redact value with ***", () => {
    const { write, text } = capture();
    const log = createLogger({ write, redact: ["secret-token", "api-key-xyz"] });
    log.info("http", { url: "https://api/?token=secret-token&key=api-key-xyz" });
    expect(text()).toContain("***");
    expect(text()).not.toContain("secret-token");
    expect(text()).not.toContain("api-key-xyz");
  });

  it("also redacts inside group names", () => {
    const { write, text } = capture();
    const log = createLogger({ write, redact: ["hidden"] });
    log.group("running hidden step");
    expect(text()).toBe("::group::running *** step\n");
  });

  it("ignores empty redact entries", () => {
    const { write, text } = capture();
    const log = createLogger({ write, redact: ["", "keep-me"] });
    log.info("e", { v: "abc keep-me def" });
    expect(text()).toContain("***");
    expect(text()).toContain("abc");
    expect(text()).toContain("def");
  });
});

describe("createLogger — value quoting", () => {
  it("quotes values with whitespace or equals", () => {
    const { write, text } = capture();
    const log = createLogger({ write });
    log.info("e", { simple: "abc", spaced: "a b", equals: "k=v" });
    expect(text()).toBe(`level=info event=e simple=abc spaced="a b" equals="k=v"\n`);
  });

  it("escapes embedded double quotes", () => {
    const { write, text } = capture();
    const log = createLogger({ write });
    log.info("e", { msg: `she said "hi"` });
    expect(text()).toBe(`level=info event=e msg="she said \\"hi\\""\n`);
  });

  it("serializes number and boolean values", () => {
    const { write, text } = capture();
    const log = createLogger({ write });
    log.info("e", { n: 42, ok: true, off: false });
    expect(text()).toBe("level=info event=e n=42 ok=true off=false\n");
  });
});

describe("createLogger — GitHub Actions groups", () => {
  it("emits ::group:: and ::endgroup:: markers", () => {
    const { write, lines } = capture();
    const log = createLogger({ write });
    log.group("Phase");
    log.info("inside");
    log.endGroup();
    expect(lines()).toEqual(["::group::Phase", "level=info event=inside", "::endgroup::"]);
  });
});
