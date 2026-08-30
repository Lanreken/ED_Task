# Task Service

Port: `3002`

Owns task state and task domain events.

MongoDB database: `ed_task_service`

Collections:

- `tasks`
- `events`
- `idempotency_keys`

Publishes:

- `TASK_CREATED`
- `TASK_UPDATED`
- `TASK_COMPLETED`
- `TASK_DELETED`
- `TASK_OVERDUE`

Runtime processes:

- HTTP API: `npm run dev`
- Outbox publisher: `npm run publisher`
