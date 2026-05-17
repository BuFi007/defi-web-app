export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, data?: LogFields): void;
  info(event: string, data?: LogFields): void;
  warn(event: string, data?: LogFields): void;
  error(event: string, data?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export function createLogger(bindings: LogFields = {}): Logger {
  const emit = (level: LogLevel, event: string, data?: LogFields) => {
    const line = JSON.stringify(
      {
        t: new Date().toISOString(),
        level,
        event,
        ...bindings,
        ...data,
      },
      bigintReplacer,
    );
    if (level === "warn" || level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  };
  return {
    debug: (event, data) => emit("debug", event, data),
    info: (event, data) => emit("info", event, data),
    warn: (event, data) => emit("warn", event, data),
    error: (event, data) => emit("error", event, data),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
