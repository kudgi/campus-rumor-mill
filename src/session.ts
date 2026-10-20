import crypto from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from './config';
import { query } from './db/pool';
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
    const token = randomSecret();
    const result = await query<{ id: string; created_at: string }>(
      'UPDATE sessions SET token_hash=$1,recovery_code_hash=$2,last_seen_at=now() WHERE recovery_code_hash=$3 RETURNING id,created_at',
      [hash(token), hash(randomSecret()), hash(req.body.recoveryCode)],
    );
    if (!result.rowCount)
      throw new AppError(401, 'INVALID_RECOVERY_CODE', 'Invalid or already used recovery code');
    setCookie(res, token);
    res.json({ session: result.rows[0], token });
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
