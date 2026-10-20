process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/campus_rumor_mill';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-16';
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'test-admin-key';
