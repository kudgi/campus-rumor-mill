import { Router } from 'express';
import { z } from 'zod';
import { config } from './config';
import { query, withTransaction } from './db/pool';
import { AppError, isUniqueViolation } from './errors';
import { asyncRoute, requireSession, validate } from './middleware';
import { broadcast } from './ws';

const categories = ['academic', 'hostel', 'canteen', 'sports', 'events', 'other'] as const;
const createSchema = z.object({
  text: z.string().trim().min(1).max(500),
  category: z.enum(categories),
});
const listSchema = z.object({
  category: z.enum(categories).optional(),
  status: z.enum(['active', 'debunked']).optional(),
  sort: z.enum(['new', 'credibility']).default('new'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const idSchema = z.object({ id: z.string().uuid() });
type RumorRow = {
  id: string;
  session_id: string;
  text: string;
  category: string;
  status: string;
  base_score: number;
  upvote_count: number;
  flag_count: number;
  created_at: string;
  last_boost_at: string;
};
export function calculateCredibility(
  row: { base_score: number; upvote_count: number; last_boost_at: string },
  now = Date.now(),
) {
  const hours = Math.max(0, (now - new Date(row.last_boost_at).getTime()) / 3600000);
  return Math.max(
    0,
    Math.min(
      100,
      (Number(row.base_score) + row.upvote_count * config.UPVOTE_WEIGHT) *
        Math.exp(-config.DECAY_LAMBDA * hours),
    ),
  );
}
const selectColumns =
  'r.id,r.session_id,r.text,r.category,r.status,r.base_score,r.upvote_count,r.flag_count,r.created_at,r.last_boost_at';
const returnColumns =
  'id,session_id,text,category,status,base_score,upvote_count,flag_count,created_at,last_boost_at';
export const enrich = (row: RumorRow): RumorRow & { credibility: number } => {
  return { ...row, credibility: calculateCredibility(row) };
};
const router = Router();
router.post(
  '/',
  requireSession,
  validate(createSchema),
  asyncRoute(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const allowed = await client.query<{ id: string }>(
        "UPDATE sessions SET last_rumor_at=now() WHERE id=$1 AND (last_rumor_at IS NULL OR last_rumor_at <= now() - interval '1 hour') RETURNING id",
        [req.session!.id],
      );
      if (!allowed.rowCount) {
        const retry = await client.query<{ seconds: string }>(
          "SELECT EXTRACT(EPOCH FROM (last_rumor_at + interval '1 hour' - now())) AS seconds FROM sessions WHERE id=$1",
          [req.session!.id],
        );
        throw new AppError(429, 'RUMOR_RATE_LIMITED', 'Only one rumor may be posted per hour', {
          retryAfterSeconds: Math.max(1, Math.ceil(Number(retry.rows[0]?.seconds ?? 3600))),
        });
      }
      const rumor = await client.query(
        `INSERT INTO rumors(session_id,text,category,base_score) VALUES($1,$2,$3,$4) RETURNING ${returnColumns}`,
        [req.session!.id, req.body.text, req.body.category, config.INITIAL_CREDIBILITY],
      );
      return rumor.rows[0];
    });
    res.status(201).json(enrich(result));
    broadcast('rumor:new', enrich(result), req.body.category);
  }),
);
router.get(
  '/',
  validate(listSchema, 'query'),
  asyncRoute(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listSchema>;
    const values: unknown[] = [];
    const filters: string[] = [];
    if (q.category) {
      values.push(q.category);
      filters.push(`r.category=$${values.length}`);
    }
    if (q.status) {
      values.push(q.status);
      filters.push(`r.status=$${values.length}`);
    }
    values.push(q.limit, (q.page - 1) * q.limit);
    const order =
      q.sort === 'credibility' ? 'r.upvote_count DESC, r.created_at DESC' : 'r.created_at DESC';
    const result = await query(
      `SELECT ${selectColumns} FROM rumors r ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY ${order} LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    res.json({ items: (result.rows as RumorRow[]).map(enrich), page: q.page, limit: q.limit });
  }),
);
router.get(
  '/category/:category',
  validate(z.object({ category: z.enum(categories) }), 'params'),
  asyncRoute(async (req, res) => {
    const result = await query(
      `SELECT ${selectColumns} FROM rumors r WHERE category=$1 ORDER BY created_at DESC LIMIT 50`,
      [String(req.params.category)],
    );
    res.json({ items: (result.rows as RumorRow[]).map(enrich) });
  }),
);
router.get(
  '/:id',
  validate(idSchema, 'params'),
  asyncRoute(async (req, res) => {
    const result = await query(`SELECT ${selectColumns} FROM rumors r WHERE id=$1`, [
      String(req.params.id),
    ]);
    if (!result.rowCount) throw new AppError(404, 'NOT_FOUND', 'Rumor not found');
    res.json(enrich(result.rows[0] as RumorRow));
  }),
);
router.get(
  '/:id/credibility',
  validate(idSchema, 'params'),
  asyncRoute(async (req, res) => {
    const result = await query(
      `SELECT base_score,upvote_count,last_boost_at FROM rumors WHERE id=$1`,
      [req.params.id],
    );
    if (!result.rowCount) throw new AppError(404, 'NOT_FOUND', 'Rumor not found');
    const row = result.rows[0] as {
      base_score: number;
      upvote_count: number;
      last_boost_at: string;
    };
    res.json({
      score: calculateCredibility(row),
      initial: Number(row.base_score),
      upvoteWeight: config.UPVOTE_WEIGHT,
      lambda: config.DECAY_LAMBDA,
      halfLifeHours: Math.log(2) / config.DECAY_LAMBDA,
      lastActivity: row.last_boost_at,
    });
  }),
);
router.post(
  '/:id/upvote',
  requireSession,
  validate(idSchema, 'params'),
  asyncRoute(async (req, res) => {
    res.json(await vote(String(req.params.id), req.session!.id, 'upvote'));
  }),
);
router.post(
  '/:id/flag',
  requireSession,
  validate(idSchema, 'params'),
  asyncRoute(async (req, res) => {
    res.json(await vote(String(req.params.id), req.session!.id, 'flag'));
  }),
);
async function vote(rumorId: string, sessionId: string, type: 'upvote' | 'flag') {
  const result = await withTransaction(async (client) => {
    const rumor = await client.query<{ session_id: string; status: string; flag_count: number }>(
      'SELECT session_id,status,flag_count FROM rumors WHERE id=$1 FOR UPDATE',
      [rumorId],
    );
    if (!rumor.rowCount) throw new AppError(404, 'NOT_FOUND', 'Rumor not found');
    if (rumor.rows[0].session_id === sessionId)
      throw new AppError(403, 'SELF_VOTE', 'You cannot vote on your own rumor');
    if (type === 'upvote' && rumor.rows[0].status === 'debunked')
      throw new AppError(409, 'DEBUNKED', 'Debunked rumors cannot be upvoted');
    try {
      await client.query('INSERT INTO votes(rumor_id,session_id,type) VALUES($1,$2,$3)', [
        rumorId,
        sessionId,
        type,
      ]);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new AppError(409, 'DUPLICATE_VOTE', 'This vote has already been recorded');
      throw error;
    }
    const field = type === 'upvote' ? 'upvote_count' : 'flag_count';
    const updated = await client.query(
      `UPDATE rumors SET ${field}=${field}+1,last_boost_at=now(),status=CASE WHEN $1='flag' AND flag_count+1 >= $2 THEN 'debunked' ELSE status END WHERE id=$3 RETURNING ${returnColumns}`,
      [type, config.FLAG_THRESHOLD, rumorId],
    );
    return enrich(updated.rows[0]);
  });
  const enriched = enrich(result as RumorRow);
  broadcast(type === 'upvote' ? 'rumor:upvoted' : 'rumor:flagged', enriched, enriched.category);
  if (type === 'flag' && enriched.status === 'debunked')
    broadcast('rumor:debunked', enriched, enriched.category);
  return enriched;
}
export default router;
