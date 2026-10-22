# Campus Rumor Mill

[![CI](https://github.com/kudgi/campus-rumor-mill/actions/workflows/ci.yml/badge.svg)](https://github.com/kudgi/campus-rumor-mill/actions/workflows/ci.yml)

Anonymous campus rumors with credibility decay, session-based voting, automatic debunking, and live WebSocket updates. The application is not deployed; it runs locally with Docker Compose.

## Features and tech stack

- Node.js 22, Express, TypeScript, PostgreSQL, and `pg`
- `ws` WebSockets with category subscriptions and heartbeat handling
- Zod request validation, Helmet, CORS, structured HTTP logging, and JSON errors
- Hashed anonymous session tokens, HttpOnly cookies, bearer authentication, and one-time recovery codes
- Jest, Supertest, Docker, Docker Compose, GitHub Actions, and a Render blueprint

## Quick start

### Run it locally in 2 minutes

From the repository root:

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:3000` for the demo page. The health check is available at `http://localhost:3000/health`.

For a non-Docker run, start PostgreSQL first, set `DATABASE_URL` and the other values in `.env`, then run:

```bash
npm install
npm run migrate
npm run dev
```

## Environment variables

| Variable                             | Description                                              |
| ------------------------------------ | -------------------------------------------------------- |
| `DATABASE_URL`                       | PostgreSQL connection string                             |
| `PORT`                               | HTTP port                                                |
| `CORS_ORIGIN`                        | Allowed browser origin                                   |
| `SESSION_SECRET`                     | Secret used to salt IP and user-agent fingerprint hashes |
| `ADMIN_API_KEY`                      | API key for the administrative debunk endpoint           |
| `FLAG_THRESHOLD`                     | Number of flags required to auto-debunk a rumor          |
| `DECAY_LAMBDA`                       | Exponential credibility decay rate per hour              |
| `UPVOTE_WEIGHT`                      | Credibility points added per upvote                      |
| `INITIAL_CREDIBILITY`                | Starting credibility for a new rumor                     |
| `COOKIE_SECURE`                      | Whether session cookies require HTTPS                    |
| `TRUST_PROXY`                        | Number of trusted reverse proxies                        |
| `SESSION_FINGERPRINT_LIMIT`          | Maximum new sessions per fingerprint window              |
| `SESSION_FINGERPRINT_WINDOW_SECONDS` | Session fingerprint throttling window                    |
| `RECOVERY_ATTEMPT_LIMIT`             | Maximum recovery attempts per fingerprint window         |
| `RECOVERY_ATTEMPT_WINDOW_SECONDS`    | Recovery attempt throttling window                       |

See [.env.example](.env.example) for the configured local defaults.

## Architecture

```text
Browser -> Express routes -> validation and middleware -> PostgreSQL
   \-> WebSocket hub <- rumor events and the 10-second credibility/trending ticker
```

See [docs/architecture.md](docs/architecture.md) for the component overview.

## API reference

| Method | Path                        | Auth              | Purpose                                                          |
| ------ | --------------------------- | ----------------- | ---------------------------------------------------------------- |
| POST   | `/session/init`             | No                | Create a session, token, and one-time recovery code              |
| POST   | `/session/recover`          | No                | Rotate a session token using a recovery code                     |
| GET    | `/session/me`               | Session           | Return session identity and activity counts                      |
| POST   | `/rumor`                    | Session           | Create a rumor; limited to one per session per hour              |
| GET    | `/rumors`                   | No                | List rumors with category, status, sort, page, and limit filters |
| GET    | `/rumor/:id`                | No                | Return one rumor                                                 |
| GET    | `/rumor/category/:category` | No                | Return up to 50 rumors in a category                             |
| GET    | `/rumor/:id/credibility`    | No                | Return the current score and decay components                    |
| POST   | `/rumor/:id/upvote`         | Session           | Add one unique upvote                                            |
| POST   | `/rumor/:id/flag`           | Session           | Add one unique flag and possibly auto-debunk                     |
| PATCH  | `/rumor/:id/debunk`         | `x-admin-api-key` | Debunk a rumor; returns 409 if already debunked                  |
| GET    | `/trending?limit=1..50`     | No                | Return active rumors by current credibility                      |
| GET    | `/health`                   | No                | Check database connectivity                                      |
| WS     | `/rumors/live`              | Optional          | Receive live events and subscribe by category                    |

Errors use `{ "error": { "code": "...", "message": "...", "details": [...] } }`. The `details` property is included for validation or throttling information when applicable. Public rumor, trending, vote, debunk, and WebSocket payloads do not include `session_id`.

Full request examples are in [requests.http](requests.http).

## Example requests

Users cannot vote on their own rumors, so the first command creates a poster session and a separate voter session. The voter token is stored in `$TOKEN` for the remaining commands.

```bash
POSTER_TOKEN=$(curl -s -X POST http://localhost:3000/session/init | jq -r '.token')
TOKEN=$(curl -s -X POST http://localhost:3000/session/init | jq -r '.token')
```

```bash
RUMOR_ID=$(curl -s -X POST http://localhost:3000/rumor \
  -H "Authorization: Bearer $POSTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"The library is open late today.","category":"academic"}' | jq -r '.id')
```

```bash
curl -X POST "http://localhost:3000/rumor/$RUMOR_ID/upvote" \
  -H "Authorization: Bearer $TOKEN"
```

```bash
curl -X POST "http://localhost:3000/rumor/$RUMOR_ID/flag" \
  -H "Authorization: Bearer $TOKEN"
```

```bash
curl "http://localhost:3000/trending?limit=10"
```

These examples require `curl` and `jq`.

## WebSocket events

Connect to `ws://localhost:3000/rumors/live`. Send `{"subscribe":"hostel"}` to receive events for the hostel category. Send `{"subscribe":null}` or `{"subscribe":"all"}` to clear the category filter. Events are `rumor:new`, `rumor:upvoted`, `rumor:flagged`, `rumor:debunked`, `credibility:update`, and `trending:update`.

## Testing

```bash
npm run format:check
npm run lint
npm run type-check
npm test
```

`npm test` runs coverage-enabled tests. Database-backed integration tests run by default; set `RUN_INTEGRATION_TESTS=false` only when intentionally skipping them. `npm run test:unit` runs the unit tests without database integration tests.

## Design decisions and trade-offs

- **Atomic rumor rate limit:** rumor creation first performs one conditional `UPDATE sessions ... RETURNING id` inside the same transaction as the insert. A failed update returns the calculated retry time without inserting a rumor.
- **Decay-on-read:** the database stores `base_score`, `upvote_count`, and `last_boost_at`; the current credibility is calculated when data is read instead of persisting a decayed value.
- **Concurrency-safe votes:** the database uniqueness constraint prevents duplicate `(rumor_id, session_id, type)` votes, while `SELECT ... FOR UPDATE` serializes updates to the rumor row before its counter is incremented.
- **Recovery and abuse prevention:** session tokens and recovery codes are stored as SHA-256 hashes. Recovery rotates the token, invalidates the previous token, consumes the recovery code, and rate-limits attempts by fingerprint.
- **Privacy:** public serializers remove `session_id` from HTTP and WebSocket rumor payloads.
- **Consistent ranking:** `/trending` and `/rumors?sort=credibility` use the same exported SQL credibility expression, so both endpoints apply the same decay calculation.

## Known limitations

- The WebSocket hub is process-local. Horizontal scaling needs Redis pub/sub or another shared event transport.
- Offset pagination is suitable for this project, but cursor pagination would be better for very large feeds.
- Recovery codes trade a small amount of anonymity for session restoration and abuse prevention.
- The application is not deployed; it runs locally through Docker Compose.

## Deployment

The repository includes a `Dockerfile` and a `render.yaml` blueprint that can be used to deploy on Render:

1. Create a Render Blueprint from the repository.
2. Provision the managed PostgreSQL database defined by the blueprint.
3. Configure the required secrets and environment variables in Render.
4. Deploy and verify the service health check and database migration startup.

## Final checklist

- [ ] No `.env` files, secrets, or credentials are committed
- [ ] CI is green
- [ ] The README and API documentation render correctly
- [ ] The local demo page and WebSocket events work
- [ ] Database migrations succeed
- [ ] Repository description and topics are set
- [ ] Repository is pinned on the GitHub profile
