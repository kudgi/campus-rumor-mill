import { Router } from 'express';
import { config } from './config';
import { query } from './db/pool';
import { credibilitySqlExpression, enrich, toPublic } from './rumors';

const router = Router();
export async function getTrending(limit = 10) {
  const result = await query(
    `SELECT r.* FROM rumors r WHERE status=$1::varchar ORDER BY ${credibilitySqlExpression('r', '$2', '$3')} DESC, r.created_at DESC, r.id DESC LIMIT $4::integer`,
    ['active', config.UPVOTE_WEIGHT, config.DECAY_LAMBDA, Math.min(Math.max(limit, 1), 50)],
  );
  return result.rows.map((row) => toPublic(enrich(row as Parameters<typeof enrich>[0])));
}
router.get('/', async (_req, res, next) => {
  try {
    res.json({ items: await getTrending(Number(_req.query.limit) || 10) });
  } catch (error) {
    next(error);
  }
});
export default router;
