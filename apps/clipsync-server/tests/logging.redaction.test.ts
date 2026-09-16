import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';

describe('operational metadata logging', () => {
  let ctx: ReturnType<typeof buildTestServer>;

  afterEach(() => {
    ctx?.cleanup();
    vi.restoreAllMocks();
  });

  it('logs operational metadata but never the request or response body', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    ctx = buildTestServer();

    const secretText = 'super-secret-verification-code-482913';
    await request(ctx.app)
      .post('/api/clipboard')
      .send({ contentType: 'text/plain', ciphertext: secretText });

    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join('\n');
    expect(joined).not.toContain(secretText);
    expect(joined).toMatch(/POST \/api\/clipboard \d{3}/);
  });

  it('catches malformed JSON against the real app and never logs the raw body', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    ctx = buildTestServer();

    const secretMarker = 'ZZZ_DISTINCTIVE_LEAK_MARKER_998877_ZZZ';
    const res = await request(ctx.app)
      .post('/api/clipboard')
      .set('Content-Type', 'application/json')
      .send(`{"ciphertext": ${secretMarker}`); // deliberately malformed JSON

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_json' });

    const joined = lines.join('\n');
    expect(joined).not.toContain(secretMarker);
  });
});
