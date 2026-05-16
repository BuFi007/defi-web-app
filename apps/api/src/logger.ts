/**
 * Tiny structured logger. JSON lines so log aggregators can parse them
 * cleanly. Swap to pino if the volume justifies a real logger.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  const emit = (level: LogLevel, event: string, data?: Record<string, unknown>) => {
    const line = JSON.stringify({
      t: new Date().toISOString(),
      level,
      event,
      ...bindings,
      ...data,
    });
    if (level === "error" || level === "warn") {
      // eslint-disable-next-line no-console
      console.error(line);
    } else {
      // eslint-disable-next-line no-console
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
