import 'dotenv/config';
import { z } from 'zod';

const env = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default('*'),
  SESSION_SECRET: z.string().min(16),
  ADMIN_API_KEY: z.string().min(8),
  FLAG_THRESHOLD: z.coerce.number().int().positive().default(5),
  DECAY_LAMBDA: z.coerce.number().positive().default(0.05),
  UPVOTE_WEIGHT: z.coerce.number().nonnegative().default(5),
  INITIAL_CREDIBILITY: z.coerce.number().min(0).max(100).default(50),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  TRUST_PROXY: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(process.env.NODE_ENV === 'production' ? 1 : 0),
  SESSION_FINGERPRINT_LIMIT: z.coerce.number().int().positive().default(5),
  SESSION_FINGERPRINT_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
});

export const config = env.parse(process.env);
