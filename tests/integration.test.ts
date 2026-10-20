import request from 'supertest';
import { createApp } from '../src/app';
import { pool, query } from '../src/db/pool';

const enabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeDatabase = enabled ? describe : describe.skip;
const app = createApp();
let owner: string;
let voter: string;
let rumorId: string;

describeDatabase('database-backed API behavior', () => {
  beforeAll(async () => {
    await query('TRUNCATE votes, rumors, sessions CASCADE');
    owner = (await request(app).post('/session/init')).body.token;
    voter = (await request(app).post('/session/init')).body.token;
    const created = await request(app)
      .post('/rumor')
      .set('Authorization', `Bearer ${owner}`)
      .send({ text: 'A test rumor', category: 'hostel' });
    rumorId = created.body.id;
  });
  afterAll(async () => {
    await pool.end();
  });

  it('rejects duplicate and concurrent upvotes without double counting', async () => {
    const first = await request(app)
      .post(`/rumor/${rumorId}/upvote`)
      .set('Authorization', `Bearer ${voter}`);
    expect(first.status).toBe(200);
    expect(
      (await request(app).post(`/rumor/${rumorId}/upvote`).set('Authorization', `Bearer ${voter}`))
        .status,
    ).toBe(409);
    const another = (await request(app).post('/session/init')).body.token;
    const responses = await Promise.all([
      request(app).post(`/rumor/${rumorId}/upvote`).set('Authorization', `Bearer ${another}`),
      request(app).post(`/rumor/${rumorId}/upvote`).set('Authorization', `Bearer ${another}`),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it('enforces the one-rumor-per-hour rate limit', async () => {
    const response = await request(app)
      .post('/rumor')
      .set('Authorization', `Bearer ${owner}`)
      .send({ text: 'Second rumor', category: 'events' });
    expect(response.status).toBe(429);
    expect(response.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('rotates the token during recovery', async () => {
    const session = await request(app).post('/session/init');
    const recovered = await request(app)
      .post('/session/recover')
      .send({ recoveryCode: session.body.recoveryCode });
    expect(recovered.status).toBe(200);
    expect(recovered.body.token).not.toBe(session.body.token);
    expect(
      (await request(app).get('/session/me').set('Authorization', `Bearer ${session.body.token}`))
        .status,
    ).toBe(401);
    expect(
      (await request(app).get('/session/me').set('Authorization', `Bearer ${recovered.body.token}`))
        .status,
    ).toBe(200);
  });

  it('auto-debunks at the configured flag threshold', async () => {
    const flaggers = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post('/session/init')
          .then((response) => response.body.token),
      ),
    );
    for (const token of flaggers)
      await request(app).post(`/rumor/${rumorId}/flag`).set('Authorization', `Bearer ${token}`);
    const result = await request(app).get(`/rumor/${rumorId}`);
    expect(result.body.status).toBe('debunked');
  });
});
