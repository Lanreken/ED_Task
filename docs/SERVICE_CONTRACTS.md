# Service Contracts

## Port Map

| Service | Port | Public? | Main Runtime |
| --- | ---: | --- | --- |
| API Gateway | `3000` | Yes | Express/Fastify HTTP API |
| User Service | `3001` | No | Express/Fastify HTTP API |
| Task Service | `3002` | No | Express/Fastify HTTP API + outbox publisher |
| Reminder Service | `3003` | No | HTTP health API + BullMQ workers |
| Notification Service | `3004` | No | HTTP health API + BullMQ workers |
| AI Service | `3005` | No | HTTP API + queue consumer |
| Analytics Service | `3006` | No | HTTP health API + event consumer |

Only the API Gateway should be exposed to the frontend.

## API Gateway

Responsibilities:

- authenticate requests
- apply rate limits
- validate request size
- attach `traceId`
- forward requests to internal services
- return consistent API errors

Does not own business data.

## User Service

Responsibilities:

- user registration/login
- password hashing
- user preferences
- auth profile lookup

MongoDB database:

- `ed_user_service`

Publishes:

- `USER_CREATED`
- `USER_UPDATED`
- `USER_PREFERENCES_UPDATED`

## Task Service

Responsibilities:

- create tasks
- update tasks
- complete tasks
- own task state
- publish task events through outbox

MongoDB database:

- `ed_task_service`

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

Consumes:

- none for MVP

## Reminder Service

Responsibilities:

- consume task events
- calculate reminder schedules
- create delayed jobs
- emit reminder events
- reconcile missed reminders

MongoDB database:

- `ed_reminder_service`

Collections:

- `reminder_schedules`
- `jobs`
- `processed_events`

Publishes:

- `REMINDER_SCHEDULED`
- `REMINDER_TRIGGERED`
- `REMINDER_FAILED`

Consumes:

- `TASK_CREATED`
- `TASK_UPDATED`
- `TASK_COMPLETED`
- `TASK_DELETED`

## Notification Service

Responsibilities:

- send email/push/browser notifications
- record delivery status
- retry failed deliveries
- move permanent failures to DLQ

MongoDB database:

- `ed_notification_service`

Collections:

- `notifications`
- `delivery_attempts`
- `dead_letters`
- `processed_events`

Publishes:

- `NOTIFICATION_SENT`
- `NOTIFICATION_FAILED`
- `DEAD_LETTER_CREATED`

Consumes:

- `REMINDER_TRIGGERED`

## AI Service

Responsibilities:

- task breakdown suggestions
- priority suggestions
- planning suggestions

MongoDB database:

- `ed_ai_service`

Collections:

- `ai_requests`
- `task_suggestions`
- `processed_events`

Publishes:

- `AI_TASK_BREAKDOWN_CREATED`
- `AI_TASK_PRIORITY_SUGGESTED`

Consumes:

- `TASK_CREATED`
- `USER_REQUESTED_AI_HELP`

## Analytics Service

Responsibilities:

- consume events
- build reporting projections
- expose system summaries later

MongoDB database:

- `ed_analytics_service`

Collections:

- `event_projections`
- `daily_metrics`
- `processed_events`

Consumes:

- all domain events
