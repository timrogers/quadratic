import { AsyncLocalStorage } from "async_hooks";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const envLevel = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
const minLevel = LEVELS[envLevel] ?? LEVELS.info;

interface LogContext {
  requestId?: string;
  [key: string]: unknown;
}

const contextStore = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  return contextStore.run({ ...(contextStore.getStore() || {}), ...ctx }, fn);
}

function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < minLevel) return;
  const ctx = contextStore.getStore() || {};
  const record = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...ctx,
    ...(fields || {}),
  };
  const out = JSON.stringify(record);
  if (level === "error") {
    process.stderr.write(out + "\n");
  } else {
    process.stdout.write(out + "\n");
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
  child: (extra: Record<string, unknown>) => ({
    debug: (msg: string, fields?: Record<string, unknown>) =>
      emit("debug", msg, { ...extra, ...(fields || {}) }),
    info: (msg: string, fields?: Record<string, unknown>) =>
      emit("info", msg, { ...extra, ...(fields || {}) }),
    warn: (msg: string, fields?: Record<string, unknown>) =>
      emit("warn", msg, { ...extra, ...(fields || {}) }),
    error: (msg: string, fields?: Record<string, unknown>) =>
      emit("error", msg, { ...extra, ...(fields || {}) }),
  }),
};
