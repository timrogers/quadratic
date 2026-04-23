import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { log, runWithLogContext } from "../logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// Attaches a request id, logs the start and completion of every HTTP request,
// and propagates the id via AsyncLocalStorage so child logs are correlated.
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const incoming =
    (req.headers["x-request-id"] as string | undefined) ||
    (req.headers["x-correlation-id"] as string | undefined);
  const requestId = incoming || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  const start = process.hrtime.bigint();

  runWithLogContext({ requestId }, () => {
    log.info("http.request.received", {
      method: req.method,
      path: req.originalUrl || req.url,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
    });

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      log[level]("http.request.completed", {
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });

    res.on("close", () => {
      if (!res.writableEnded) {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        log.warn("http.request.aborted", {
          method: req.method,
          path: req.originalUrl || req.url,
          durationMs: Math.round(durationMs * 100) / 100,
        });
      }
    });

    next();
  });
}
