import type { RequestHandler, ErrorRequestHandler } from 'express';

export function requestLogger(sink: (line: string) => void = console.log): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const contentLength = res.getHeader('content-length') ?? '0';
      const contentType = res.getHeader('content-type') ?? 'none';
      // Deliberately omits req.body, res.body, and every signature/auth
      // header value — only method, path, status, timing, content-type, and size.
      sink(`${req.method} ${req.path} ${res.statusCode} ${ms}ms content-type=${contentType} size=${contentLength}`);
    });
    next();
  };
}

export function errorLogger(sink: (line: string) => void = console.log): ErrorRequestHandler {
  return (err, req, res, _next) => {
    // Never log err.message or err.stack — for a body-parser SyntaxError or
    // a Multer error, .message can embed the actual raw request body.
    // Method, path, and the error's constructor name are always safe.
    sink(`${req.method} ${req.path} error=${err?.constructor?.name ?? 'Error'}`);

    if (res.headersSent) return;

    const isJsonParseError =
      err instanceof SyntaxError && (err as any).type === 'entity.parse.failed';
    const isMulterError = err?.name === 'MulterError';

    if (isJsonParseError) {
      res.status(400).json({ error: 'invalid_json' });
      return;
    }
    if (isMulterError) {
      res.status(400).json({ error: 'upload_error' });
      return;
    }
    res.status(500).json({ error: 'internal_error' });
  };
}
