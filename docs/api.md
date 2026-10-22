# API reference

All local examples use `http://localhost:3000`.

| Method | Path                        | Auth              | Purpose                                             |
| ------ | --------------------------- | ----------------- | --------------------------------------------------- |
| POST   | `/session/init`             | No                | Create a session, token, and one-time recovery code |
| POST   | `/session/recover`          | No                | Rotate a token using a recovery code                |
| GET    | `/session/me`               | Session           | Return session identity and counters                |
| POST   | `/rumor`                    | Session           | Create a rumor                                      |
| GET    | `/rumors`                   | No                | List rumors with filters and pagination             |
| GET    | `/rumor/:id`                | No                | Read a rumor                                        |
| GET    | `/rumor/category/:category` | No                | List rumors in a category                           |
| GET    | `/rumor/:id/credibility`    | No                | Read the current credibility components             |
| POST   | `/rumor/:id/upvote`         | Session           | Add one unique upvote                               |
| POST   | `/rumor/:id/flag`           | Session           | Add one unique flag                                 |
| PATCH  | `/rumor/:id/debunk`         | `x-admin-api-key` | Debunk a rumor; repeated debunking returns 409      |
| GET    | `/trending?limit=1..50`     | No                | Return active rumors by decayed credibility         |
| GET    | `/health`                   | No                | Check database connectivity                         |
| WS     | `/rumors/live`              | Optional          | Receive live events and category subscriptions      |

Errors use:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": []
  }
}
```

`details` is omitted unless the error has additional information. Validation details contain `path` and `message`. Public rumor, trending, vote, debunk, and WebSocket payloads do not contain `session_id`.

The WebSocket client can send `{"subscribe":"hostel"}` to filter category events. `{"subscribe":null}` and `{"subscribe":"all"}` clear the filter.
