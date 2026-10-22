# Campus Rumor Mill

[![CI](https://github.com/kudgi/campus-rumor-mill/actions/workflows/ci.yml/badge.svg)](https://github.com/kudgi/campus-rumor-mill/actions/workflows/ci.yml)

Anonymous campus rumors with credibility decay, durable anonymous sessions, idempotent voting, automatic debunking, and live WebSocket updates. Live demo: `https://your-deployment.example.com`.

## Features and stack

- Node.js 22, Express, TypeScript, PostgreSQL, `pg`, `ws`, Zod
- Hashed 32-byte session tokens, HttpOnly cookies, bearer authentication, one-time recovery codes
- Database-enforced rate limiting and vote uniqueness
- Decay-on-read credibility and live ticker updates
- Jest/Supertest, Docker Compose, GitHub Actions, Render blueprint

## Quick start

```bash
cp .env.example .env
npm install
docker compose up --build
```

The demo is at `http://localhost:3000/`; health is `GET /health`. For a local non-Docker run, start PostgreSQL, set `.env`, then run `npm run migrate` and `npm run dev`.

## Environment

| Variable              | Description                         |
| --------------------- | ----------------------------------- |
| `DATABASE_URL`        | PostgreSQL connection string        |
| `PORT`                | HTTP port                           |
| `CORS_ORIGIN`         | Allowed browser origin              |
| `SESSION_SECRET`      | Salt for device fingerprints        |
| `ADMIN_API_KEY`       | Internal debunk key                 |
| `FLAG_THRESHOLD`      | Flags needed for auto-debunk        |
| `DECAY_LAMBDA`        | Decay rate per hour                 |
| `UPVOTE_WEIGHT`       | Score added per upvote              |
| `INITIAL_CREDIBILITY` | New rumor score                     |
| `COOKIE_SECURE`       | Enable secure cookies in production |

See `.env.example` for all variables and defaults.

## Architecture

```text
Client -> Express routes -> validation/middleware -> services/repositories -> PostgreSQL
   \-> WebSocket hub <- domain events and 10-second credibility/trending ticker
```

See [docs/architecture.md](docs/architecture.md) and [docs/api.md](docs/api.md).

## API reference

| Method | Endpoint                    | Description                            |
| ------ | --------------------------- | -------------------------------------- |
| POST   | `/session/init`             | Create session token and recovery code |
| POST   | `/session/recover`          | Rotate token from recovery code        |
| GET    | `/session/me`               | Session counters                       |
| POST   | `/rumor`                    | Create a rumor                         |
| GET    | `/rumors`                   | Paginated/filterable rumor list        |
| GET    | `/rumor/:id`                | Rumor detail                           |
| GET    | `/rumor/category/:category` | Category list                          |
| GET    | `/rumor/:id/credibility`    | Current score and components           |
| POST   | `/rumor/:id/upvote`         | Atomic, unique upvote                  |
| POST   | `/rumor/:id/flag`           | Atomic, unique flag                    |
| PATCH  | `/rumor/:id/debunk`         | Admin-only debunk                      |
| GET    | `/trending`                 | Top active rumors                      |
| WS     | `/rumors/live`              | Live event stream                      |

Full examples are in [requests.http](requests.http).

## WebSocket events

Connect to `wss://your-deployment.example.com/rumors/live` (or `ws://localhost:3000/rumors/live`). Send `{"subscribe":"hostel"}` to filter category events. Events are `rumor:new`, `rumor:upvoted`, `rumor:flagged`, `rumor:debunked`, `credibility:update`, and `trending:update`.

## Testing

```bash
npm run lint
npm run type-check
npm test
```

CI starts PostgreSQL, runs migrations, executes all checks, and builds the Docker image.

## Design decisions and trade-offs

- **Decay-on-read:** only base score, upvotes, and last activity are persisted; scores stay accurate without a background write for every rumor.
- **Atomic counters:** a transaction locks the rumor row, inserts a uniquely constrained vote, and increments one counter. Concurrent requests cannot double count.
- **Recovery vs anonymity:** the recovery code is returned once and stored only as a hash. Recovery restores identity while rotating and invalidating the prior token.
- **Rate limiting:** the one-rumor-per-hour rule uses `sessions.last_rumor_at`, not process memory, so it works across instances.
- **WebSocket scale:** the hub is process-local; production horizontal scaling should add Redis/NATS pub/sub.

## Deploy to Render

1. Push the repository to GitHub and create a Render Blueprint from `render.yaml`.
2. Attach the managed PostgreSQL database and set `CORS_ORIGIN` to the deployed app origin.
3. Add/rotate `ADMIN_API_KEY` and ensure `SESSION_SECRET` is generated.
4. Render builds the Docker image; its startup command runs migrations before the server.
5. Verify `https://YOUR-SERVICE.onrender.com/health`.

Replace the badge owner, live URL, and the sample host in the WebSocket section after deployment. Test with `curl -X POST https://YOUR-SERVICE.onrender.com/session/init`.

## Planned commit sequence

1. `chore: init project with TypeScript, ESLint, Prettier` — package/config files
2. `feat(db): add schema and migrations` — `src/db/**`
3. `feat(session): add anonymous session flow` — config, middleware, session routes
4. `feat(session): add recovery code flow` — recovery validation and rotation
5. `feat(rumor): add rumor API and rate limit` — rumor routes and validation
6. `feat(credibility): add decay-on-read scoring` — scoring and credibility endpoint
7. `feat(votes): add idempotent voting` — votes schema and transactions
8. `feat(debunk): add automatic and admin debunking` — thresholds and endpoint
9. `feat(ws): add live feed and subscriptions` — WebSocket hub/ticker
10. `feat(trending): add trending endpoint and broadcasts` — trending service
11. `test: add API and concurrency coverage` — `tests/**`
12. `chore(docker): add Docker and CI` — Docker, Compose, workflow
13. `docs: add API and deployment documentation` — README/docs/templates

Use `feature/<name>` branches and merge pull requests into deployable `main`.

## Final sharing checklist

- [ ] No `.env`, secrets, or credentials committed
- [ ] CI is green on `main`
- [ ] README links and badge use the real repository
- [ ] Demo page and WebSocket events work
- [ ] Render health check and migrations succeed
- [ ] Repository description/topics are set
- [ ] Repository is pinned on your GitHub profile
