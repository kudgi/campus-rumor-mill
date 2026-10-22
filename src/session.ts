import crypto from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from './config';
import { query, withTransaction } from './db/pool';
import { AppError } from './errors';
import { asyncRoute, requireSession, validate } from './middleware';

const router = Router();
const recoverSchema = z.object({ recoveryCode: z.string().min(16) });
function randomSecret() {
  return crypto.randomBytes(32).toString('base64url');
}
function hash(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function hashesMatch(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(received, 'hex');
  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}
function fingerprint(req: Request) {
  return hash(`${config.SESSION_SECRET}:${req.ip}:${req.get('user-agent') ?? ''}`);
}
function setCookie(res: Response, token: string) {
  res.cookie('sessionToken', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });
}
router.post(
  '/init',
  asyncRoute(async (req, res) => {
    const fp = fingerprint(req);
    const recent = await query<{ count: string }>(
      "SELECT count(*) FROM sessions WHERE fingerprint_hash = $1 AND created_at > now() - ($2 * interval '1 second')",
      [fp, config.SESSION_FINGERPRINT_WINDOW_SECONDS],
    );
    if (Number(recent.rows[0].count) >= config.SESSION_FINGERPRINT_LIMIT)
      throw new AppError(429, 'SESSION_THROTTLED', 'Too many sessions from this device', {
        retryAfterSeconds: config.SESSION_FINGERPRINT_WINDOW_SECONDS,
      });
    const token = randomSecret();
    const recoveryCode = randomSecret();
    const result = await query<{ id: string; created_at: string }>(
      'INSERT INTO sessions(token_hash,recovery_code_hash,fingerprint_hash) VALUES($1,$2,$3) RETURNING id,created_at',
      [hash(token), hash(recoveryCode), fp],
    );
    setCookie(res, token);
    res.status(201).json({ session: result.rows[0], token, recoveryCode });
  }),
);
router.post(
  '/recover',
  validate(recoverSchema),
  asyncRoute(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const fingerprintHash = fingerprint(req);
      const attempts = await client.query<{ attempt_count: number; window_started_at: string }>(
        `INSERT INTO recovery_attempts(fingerprint_hash,window_started_at,attempt_count)
         VALUES($1,now(),1)
         ON CONFLICT (fingerprint_hash) DO UPDATE SET
           attempt_count=CASE WHEN recovery_attempts.window_started_at <= now() - ($2 * interval '1 second') THEN 1 ELSE recovery_attempts.attempt_count + 1 END,
           window_started_at=CASE WHEN recovery_attempts.window_started_at <= now() - ($2 * interval '1 second') THEN now() ELSE recovery_attempts.window_started_at END
         RETURNING attempt_count,window_started_at`,
        [fingerprintHash, config.RECOVERY_ATTEMPT_WINDOW_SECONDS],
      );
      if (attempts.rows[0].attempt_count > config.RECOVERY_ATTEMPT_LIMIT) {
        throw new AppError(429, 'RECOVERY_THROTTLED', 'Too many recovery attempts', {
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(
              (new Date(attempts.rows[0].window_started_at).getTime() +
                config.RECOVERY_ATTEMPT_WINDOW_SECONDS * 1000 -
                Date.now()) /
                1000,
            ),
          ),
        });
      }
      const recoveryHash = hash(req.body.recoveryCode);
      const candidates = await client.query<{ id: string; recovery_code_hash: string }>(
        'SELECT id,recovery_code_hash FROM sessions WHERE left(recovery_code_hash,8)=$1',
        [recoveryHash.slice(0, 8)],
      );
      const candidate = candidates.rows.find((row) =>
        hashesMatch(row.recovery_code_hash, recoveryHash),
      );
      if (!candidate)
        throw new AppError(401, 'INVALID_RECOVERY_CODE', 'Invalid or already used recovery code');
      const token = randomSecret();
      const updated = await client.query<{ id: string; created_at: string }>(
        'UPDATE sessions SET token_hash=$1,recovery_code_hash=$2,last_seen_at=now() WHERE id=$3 AND recovery_code_hash=$4 RETURNING id,created_at',
        [hash(token), hash(randomSecret()), candidate.id, candidate.recovery_code_hash],
      );
      if (!updated.rowCount)
        throw new AppError(401, 'INVALID_RECOVERY_CODE', 'Invalid or already used recovery code');
      return { session: updated.rows[0], token };
    });
    setCookie(res, result.token);
    res.json(result);
  }),
);
router.get(
  '/me',
  requireSession,
  asyncRoute(async (req, res) => {
    const result = await query(
      "SELECT s.id,s.created_at,(SELECT count(*) FROM rumors r WHERE r.session_id=s.id) AS rumors_posted,(SELECT count(*) FROM votes v WHERE v.session_id=s.id AND v.type='upvote') AS upvotes,(SELECT count(*) FROM votes v WHERE v.session_id=s.id AND v.type='flag') AS flags FROM sessions s WHERE s.id=$1",
      [req.session!.id],
    );
    res.json(result.rows[0]);
  }),
);
export default router;
