import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';
import { requestLogger, errorLogger } from '../src/middleware/logging.js';

describe('requestLogger', () => {
  describe('operational metadata logging', () => {
    it('logs operational metadata but never the request or response body', async () => {
      const lines: string[] = [];

      // Create a fresh app with the logger middleware FIRST, then add the test route
      const testApp = express();
      testApp.use(requestLogger((line) => lines.push(line)));
      testApp.use(express.json());

      // Add a test endpoint that will be hit
      testApp.post('/api/clipboard', (req, res) => {
        res.status(201).json({ success: true });
      });

      const secretText = 'super-secret-verification-code-482913';
      await request(testApp)
        .post('/api/clipboard')
        .send({ contentType: 'text/plain', ciphertext: secretText });

      expect(lines.length).toBeGreaterThan(0);
      const joined = lines.join('\n');
      expect(joined).not.toContain(secretText);
      expect(joined).toMatch(/POST \/api\/clipboard \d{3}/);
    });
  });

  describe('error handling and body-parser leak prevention', () => {
    let ctx: ReturnType<typeof buildTestServer>;
    afterEach(() => ctx?.cleanup());

    it('catches malformed JSON and never logs the raw body in errors', async () => {
      ctx = buildTestServer();
      const errorLogs: string[] = [];
      const requestLogs: string[] = [];

      // Create a fresh app with both loggers, but test the error handling
      const testApp = express();
      testApp.use(requestLogger((line) => requestLogs.push(line)));
      testApp.use(
        express.json({
          verify: (req, _res, buf) => {
            (req as any).rawBody = Buffer.from(buf);
          },
        }),
      );

      // Add a real route that would process the request
      testApp.post('/api/clipboard', (req, res) => {
        res.status(201).json({ success: true });
      });

      // Mount error handler LAST
      testApp.use(errorLogger((line) => errorLogs.push(line)));

      const secretMarker = 'TOPSECRET_MARKER_XYZ';
      const malformedBody = '{"bad": ' + secretMarker;

      const response = await request(testApp)
        .post('/api/clipboard')
        .set('Content-Type', 'application/json')
        .send(malformedBody);

      // Response should be clean, not raw HTML or stack trace
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'invalid_json' });

      // Secret must not appear in error logs
      const allErrorLogs = errorLogs.join('\n');
      expect(allErrorLogs).not.toContain(secretMarker);

      // Error log should only contain safe information
      expect(allErrorLogs).toMatch(/POST \/api\/clipboard error=SyntaxError/);
    });
  });
});
