# API reference

| Method | Path                                   | Auth      | Purpose                                    |
| ------ | -------------------------------------- | --------- | ------------------------------------------ |
| POST   | `/session/init`                        | No        | Create token and one-time recovery code    |
| POST   | `/session/recover`                     | No        | Rotate token using recovery code           |
| GET    | `/session/me`                          | Session   | Session identity and counters              |
| POST   | `/rumor`                               | Session   | Create a rumor                             |
| GET    | `/rumors`, `/rumor/category/:category` | No        | List rumors                                |
| GET    | `/rumor/:id`                           | No        | Read rumor                                 |
| GET    | `/rumor/:id/credibility`               | No        | Read decay components                      |
| POST   | `/rumor/:id/upvote`                    | Session   | Idempotent upvote                          |
| POST   | `/rumor/:id/flag`                      | Session   | Idempotent flag                            |
| PATCH  | `/rumor/:id/debunk`                    | Admin key | Mark debunked; repeated debunk returns 409 |
| GET    | `/trending?limit=1..50`                | No        | Top active rumors                          |
| WS     | `/rumors/live`                         | Optional  | Live events and category subscriptions     |

Errors use `{ "error": { "code": "...", "message": "...", "details": [] } }`.
Validation details are a clean list of `{ "path": "...", "message": "..." }`.
Public rumor, trending, vote, debunk, and WebSocket payloads never include `session_id`.

For example, an already debunked rumor returns:

```json
{
  "error": {
    "code": "ALREADY_DEBUNKED",
    "message": "Rumor is already debunked"
  }
}
```
