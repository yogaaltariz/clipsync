import type { RequestHandler } from 'express';

export function requestLogger(sink: (line: string) => void = console.log): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const contentLength = res.getHeader('content-length') ?? '0';
      // Deliberately omits req.body, res.body, and every signature/auth
      // header value — only method, path, status, timing, and size.
      sink(`${req.method} ${req.path} ${res.statusCode} ${ms}ms size=${contentLength}`);
    });
    next();
  };
}
