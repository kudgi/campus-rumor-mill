import WebSocket from 'ws';
import request from 'supertest';
import { createApp, createServer } from '../src/app';
import { pool, query } from '../src/db/pool';
import { config } from '../src/config';

const describeDatabase = process.env.RUN_INTEGRATION_TESTS === 'false' ? describe.skip : describe;
const app = createApp();

async function createSession() {
  const response = await request(app).post('/session/init');
  expect(response.status).toBe(201);
  return response.body as { token: string; recoveryCode: string };
}

async function createRumor(token: string, category = 'hostel') {
  const response = await request(app)
    .post('/rumor')
    .set('Authorization', `Bearer ${token}`)
    .send({ text: `Test rumor ${Date.now()}-${Math.random()}`, category });
  expect(response.status).toBe(201);
  return response.body as { id: string; status: string; upvote_count: number; flag_count: number };
}

describeDatabase('database-backed API behavior', () => {
  beforeAll(async () => {
    await query('TRUNCATE votes, rumors, sessions CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('allows exactly one of five simultaneous rumors and returns a retry time', async () => {
    const { token } = await createSession();
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        request(app)
          .post('/rumor')
          .set('Authorization', `Bearer ${token}`)
          .send({ text: `Concurrent rumor ${index}`, category: 'events' }),
      ),
    );
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    const limited = responses.filter((response) => response.status === 429);
    expect(limited).toHaveLength(4);
    expect(limited[0].body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('accepts ten concurrent upvotes from ten sessions and rejects duplicate votes', async () => {
    const owner = await createSession();
    const rumor = await createRumor(owner.token);
    const voters = await Promise.all(Array.from({ length: 10 }, () => createSession()));
    const responses = await Promise.all(
      voters.map(({ token }) =>
        request(app).post(`/rumor/${rumor.id}/upvote`).set('Authorization', `Bearer ${token}`),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const detail = await request(app).get(`/rumor/${rumor.id}`);
    expect(detail.body.upvote_count).toBe(10);

    const duplicateResponses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post(`/rumor/${rumor.id}/upvote`)
          .set('Authorization', `Bearer ${voters[0].token}`),
      ),
    );
    expect(duplicateResponses.filter((response) => response.status === 200)).toHaveLength(0);
    expect(duplicateResponses.filter((response) => response.status === 409)).toHaveLength(5);
  });

  it('auto-debunks after concurrent threshold flags and rejects later upvotes', async () => {
    const owner = await createSession();
    const rumor = await createRumor(owner.token);
    const flaggers = await Promise.all(
      Array.from({ length: config.FLAG_THRESHOLD }, () => createSession()),
    );
    const responses = await Promise.all(
      flaggers.map(({ token }) =>
        request(app).post(`/rumor/${rumor.id}/flag`).set('Authorization', `Bearer ${token}`),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const detail = await request(app).get(`/rumor/${rumor.id}`);
    expect(detail.body.status).toBe('debunked');
    expect(detail.body.flag_count).toBe(config.FLAG_THRESHOLD);

    const voter = await createSession();
    const upvote = await request(app)
      .post(`/rumor/${rumor.id}/upvote`)
      .set('Authorization', `Bearer ${voter.token}`);
    expect(upvote.status).toBe(409);
  });

  it('rejects self-votes', async () => {
    const owner = await createSession();
    const rumor = await createRumor(owner.token);
    const response = await request(app)
      .post(`/rumor/${rumor.id}/upvote`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('SELF_VOTE');
  });

  it('sorts rumors by current decayed credibility', async () => {
    const firstOwner = await createSession();
    const secondOwner = await createSession();
    const first = await createRumor(firstOwner.token, 'academic');
    const second = await createRumor(secondOwner.token, 'academic');
    await query(
      "UPDATE rumors SET base_score=50,last_boost_at=now() - interval '48 hours' WHERE id=$1",
      [first.id],
    );
    await query(
      "UPDATE rumors SET base_score=50,last_boost_at=now() - interval '1 hour' WHERE id=$1",
      [second.id],
    );
    const response = await request(app).get('/rumors?category=academic&sort=credibility');
    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(
      response.body.items.findIndex((item: { id: string }) => item.id === second.id),
    ).toBeLessThan(response.body.items.findIndex((item: { id: string }) => item.id === first.id));
  });

  it('returns only active rumors from trending in decayed order', async () => {
    const owner = await createSession();
    const active = await createRumor(owner.token, 'sports');
    const otherOwner = await createSession();
    const debunked = await createRumor(otherOwner.token, 'sports');
    await query('UPDATE rumors SET last_boost_at=now() WHERE id=$1', [active.id]);
    await query("UPDATE rumors SET status='debunked' WHERE id=$1", [debunked.id]);
    const response = await request(app).get('/trending?limit=50');
    expect(response.status).toBe(200);
    expect(response.body.items.some((item: { id: string }) => item.id === active.id)).toBe(true);
    expect(response.body.items.some((item: { id: string }) => item.id === debunked.id)).toBe(false);
  });

  it('rotates the session token and consumes the recovery code', async () => {
    const session = await createSession();
    const recovered = await request(app)
      .post('/session/recover')
      .send({ recoveryCode: session.recoveryCode });
    expect(recovered.status).toBe(200);
    expect(recovered.body.token).not.toBe(session.token);
    expect(
      (await request(app).get('/session/me').set('Authorization', `Bearer ${session.token}`))
        .status,
    ).toBe(401);
    expect(
      (await request(app).get('/session/me').set('Authorization', `Bearer ${recovered.body.token}`))
        .status,
    ).toBe(200);
    expect(
      (await request(app).post('/session/recover').send({ recoveryCode: session.recoveryCode }))
        .status,
    ).toBe(401);
  });

  it('returns clean validation errors and does not expose session identifiers', async () => {
    const invalidTrending = await request(app).get('/trending?limit=51');
    expect(invalidTrending.status).toBe(400);
    expect(invalidTrending.body.error.details).toEqual([
      { path: 'limit', message: expect.any(String) },
    ]);
    const unknown = await request(app).get('/does-not-exist');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    const session = await createSession();
    const rumor = await createRumor(session.token);
    expect(rumor).not.toHaveProperty('session_id');
    expect(
      (await request(app).post('/rumors').send({ text: 'wrong route', category: 'other' })).status,
    ).toBe(404);
  });

  it('delivers subscribed WebSocket events only for the selected category', async () => {
    const { server, websocket } = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server did not bind to a port');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/rumors/live`);
    const events: Array<{ event: string; data: { id?: string } }> = [];
    socket.on('message', (raw) => events.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => {
        socket.send(JSON.stringify({ subscribe: 'hostel' }));
        resolve();
      });
      socket.once('error', reject);
    });
    const hostelOwner = await createSession();
    const academicOwner = await createSession();
    const hostel = await createRumor(hostelOwner.token, 'hostel');
    await createRumor(academicOwner.token, 'academic');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(events.some((item) => item.event === 'rumor:new' && item.data.id === hostel.id)).toBe(
      true,
    );
    expect(events.filter((item) => item.event === 'rumor:new')).toHaveLength(1);
    await request(app)
      .post(`/rumor/${hostel.id}/upvote`)
      .set('Authorization', `Bearer ${(await createSession()).token}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events.some((item) => item.event === 'rumor:upvoted')).toBe(true);
    socket.close();
    await websocket.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
});
