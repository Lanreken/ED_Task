# Event-Driven Task Reminder System

This repository now includes Step 2/3 architecture, Step 5 topology, and Stage 6 hardening integration.

The backend is designed as Node.js microservices with MongoDB-owned data per service and Redis for events, queues, retries, and delayed reminder jobs.

## Local Infrastructure

```bash
docker compose up -d
```

Local tools:

| Tool | URL / Port |
| --- | --- |
| MongoDB | `localhost:27017` |
| Mongo Express | `http://localhost:8081` |
| Redis | `localhost:6379` |
| Redis Commander | `http://localhost:8082` |
| Prometheus | `http://localhost:9090` |
| Alertmanager | `http://localhost:9093` |
| Loki | `http://localhost:3100` |
| Grafana | `http://localhost:3010` |

## Service Ports

| Service | Port | Responsibility |
| --- | ---: | --- |
| API Gateway | `3000` | Public entry point, auth, rate limits, routing |
| User Service | `3001` | Users, auth profile, preferences |
| Task Service | `3002` | Task ownership and task domain events |
| Reminder Service | `3003` | Reminder schedules and delayed reminder jobs |
| Notification Service | `3004` | Email/push delivery, retries, DLQ records |
| AI Service | `3005` | Task breakdowns, prioritization, suggestions |
| Analytics Service | `3006` | Event analytics and reporting |
| Cloud Sync Service | `3007` | Google Drive snapshot backup and restore preview |

## Service Folder Shape

Each service now follows the same basic structure:

```txt
services/<service-name>/
  package.json
  .env.example
  src/
    config/
    routes/
    index.ts
```

Services with business logic add more folders:

```txt
controllers/
services/
repositories/
models/
workers/
```

This is a monorepo microservices layout: services live in one Git repository, but run as separate Node.js processes on separate ports with separate responsibilities and separate MongoDB databases.

Only the repository root needs `.gitignore` for this setup. Add service-level `.gitignore` files only if a service becomes its own independent Git repository.

## Architecture Docs

- [Step 2 Architecture](./docs/STEP_2_ARCHITECTURE.md)
- [Service Contracts](./docs/SERVICE_CONTRACTS.md)
- [Event Contracts](./docs/EVENT_CONTRACTS.md)
- [MongoDB Models](./docs/MONGODB_MODELS.md) - users, tasks, events, jobs, notifications, DLQ, audit logs
- [Step 3 Redis Event System](./docs/STEP_3_REDIS_EVENT_SYSTEM.md)
- [Step 5 Distributed System Blueprint](./docs/STEP_5_DISTRIBUTED_SYSTEM_BLUEPRINT.md)
- [Reliability Flow](./docs/RELIABILITY_FLOW.md)
- [Stage 6 Hardening Implementation](./docs/STAGE_6_HARDENING_IMPLEMENTATION.md)
- [Google Drive Cloud Sync](./docs/GOOGLE_DRIVE_SYNC.md)

## Workers in This System

- Task Service: outbox publisher loop (`outboxPublisher.ts`)
- Reminder Service:
  - `taskEventsWorker` (`task.events.queue`)
  - `reminderDueWorker` (`reminder.due.queue`)
- Notification Service:
  - `notificationWorker` (`notification.send.queue`)
- Background reconciliation schedulers:
  - outbox reconciliation
  - reminder reconciliation
  - DLQ replay reconciliation

## Run Core Flow

Install dependencies:

```bash
npm install
```

Start MongoDB and Redis:

```bash
npm run infra:up
```

Start only monitoring/observability stack:

```bash
npm run infra:monitoring:up
```

Start the core event path:

```bash
npm run dev:core
```

This starts:

- API Gateway
- Task Service
- Task Outbox Publisher
- Reminder Service
- Notification Service

Start cloud backups to Google Drive:

```bash
npm run dev:cloud-sync
```

Google Drive sync uses:

1. Google Drive API enabled in your Google Cloud project
2. A service account with Drive access
3. A Drive folder ID, or a folder name the service account can create
4. The service account private key and client email in `.env`

For Alertmanager routing, set these env vars before `infra:up`:

- `SLACK_WEBHOOK_URL`
- `PAGERDUTY_ROUTING_KEY`

Create a task through the gateway:

```bash
curl -X POST http://localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-key-1' \
  -d '{
    "userId": "665f1f77bcf86cd799439011",
    "title": "Read microservices notes",
    "dueAt": "2026-05-16T23:59:00.000Z",
    "reminderIntervalMinutes": 1
  }'
```
# ED_Task
# ED_Task
