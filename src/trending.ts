import { Router } from 'express';
import { z } from 'zod';
import { config } from './config';
import { query } from './db/pool';
import { asyncRoute, validate } from './middleware';
import { credibilitySqlExpression, enrich, toPublic } from './rumors';

const router = Router();
const trendingSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export async function getTrending(limit = 10) {
  const result = await query(
    `SELECT r.* FROM rumors r WHERE status=$1::varchar ORDER BY ${credibilitySqlExpression('r', '$2', '$3')} DESC, r.created_at DESC, r.id DESC LIMIT $4::integer`,
    ['active', config.UPVOTE_WEIGHT, config.DECAY_LAMBDA, Math.min(Math.max(limit, 1), 50)],
  );
  return result.rows.map((row) => toPublic(enrich(row as Parameters<typeof enrich>[0])));
}
router.get(
  '/',
  validate(trendingSchema, 'query'),
  asyncRoute(async (req, res) => {
    res.json({
      items: await getTrending((req.query as unknown as z.infer<typeof trendingSchema>).limit),
    });
  }),
);
export default router;
