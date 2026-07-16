export type LogLevel = "debug" | "info" | "warn" | "error";

export type FieldValue = string | number | boolean;
export type Fields = Record<string, FieldValue>;

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  group(name: string): void;
  endGroup(): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  redact?: readonly string[];
  write?: (line: string) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const threshold = LEVEL_ORDER[level];
  const redactValues = (options.redact ?? []).filter((v) => v.length > 0);
  const write = options.write ?? ((line: string) => process.stderr.write(line));

  function redact(text: string): string {
    let out = text;
    for (const secret of redactValues) {
      out = out.split(secret).join("***");
    }
    return out;
  }

  function serialize(lvl: LogLevel, event: string, fields?: Fields): string {
    const parts = [`level=${lvl}`, `event=${event}`];
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        const str = String(value);
        const needsQuoting = /[\s="]/.test(str);
        const escaped = str.replace(/"/g, '\\"');
        parts.push(`${key}=${needsQuoting ? `"${escaped}"` : escaped}`);
      }
    }
    return redact(parts.join(" ")) + "\n";
  }

  function log(lvl: LogLevel, event: string, fields?: Fields): void {
    if (LEVEL_ORDER[lvl] < threshold) return;
    write(serialize(lvl, event, fields));
  }

  return {
    debug: (event, fields) => log("debug", event, fields),
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
    group: (name) => write(`::group::${redact(name)}\n`),
    endGroup: () => write(`::endgroup::\n`),
  };
}
