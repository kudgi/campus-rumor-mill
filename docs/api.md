# API reference

| Method | Path                                   | Auth      | Purpose                                 |
| ------ | -------------------------------------- | --------- | --------------------------------------- |
| POST   | `/session/init`                        | No        | Create token and one-time recovery code |
| POST   | `/session/recover`                     | No        | Rotate token using recovery code        |
| GET    | `/session/me`                          | Session   | Session identity and counters           |
| POST   | `/rumor`                               | Session   | Create a rumor                          |
| GET    | `/rumors`, `/rumor/category/:category` | No        | List rumors                             |
| GET    | `/rumor/:id`                           | No        | Read rumor                              |
| GET    | `/rumor/:id/credibility`               | No        | Read decay components                   |
| POST   | `/rumor/:id/upvote`                    | Session   | Idempotent upvote                       |
| POST   | `/rumor/:id/flag`                      | Session   | Idempotent flag                         |
| PATCH  | `/rumor/:id/debunk`                    | Admin key | Mark debunked                           |
| GET    | `/trending`                            | No        | Top active rumors                       |
| WS     | `/rumors/live`                         | Optional  | Live events and category subscriptions  |

Errors use `{ "error": { "code": "...", "message": "..." } }`.
