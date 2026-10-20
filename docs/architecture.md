# Architecture

```text
HTTP/WebSocket clients
        |
Express routes + validation + error middleware
        |---------------- WebSocket hub + ticker
controllers/services (domain operations)
        |
PostgreSQL repositories / transactions / migrations
```

The service is stateless except for PostgreSQL. WebSocket clients are held in a process-local hub; a multi-instance deployment should add a pub/sub broker.
