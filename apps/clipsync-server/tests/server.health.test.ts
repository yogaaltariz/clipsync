import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';

describe('GET /healthz', () => {
  let ctx: ReturnType<typeof buildTestServer>;

  afterEach(() => ctx?.cleanup());

  it('returns 200 with status ok when the database is reachable', async () => {
    ctx = buildTestServer();
    const res = await request(ctx.app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
