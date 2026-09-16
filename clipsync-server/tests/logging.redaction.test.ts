import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';
import { requestLogger } from '../src/middleware/logging.js';

describe('requestLogger', () => {
  let ctx: ReturnType<typeof buildTestServer>;
  afterEach(() => ctx?.cleanup());

  it('logs operational metadata but never the request or response body', async () => {
    ctx = buildTestServer();
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
    await request(testApp).post('/api/clipboard').send({ contentType: 'text/plain', ciphertext: secretText });

    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join('\n');
    expect(joined).not.toContain(secretText);
    expect(joined).toMatch(/POST \/api\/clipboard \d{3}/);
  });
});
