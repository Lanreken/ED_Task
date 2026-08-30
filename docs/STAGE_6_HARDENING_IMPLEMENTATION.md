# Stage 6 — Industry Hardening Implementation

This document tracks what is implemented in code for Stage 6.

## Implemented

1. Idempotency
- Task create supports `Idempotency-Key` with persisted key records (`idempotency_keys`).

2. API security
- Gateway supports:
  - token mode (`API_AUTH_MODE=token`)
  - JWT mode (`API_AUTH_MODE=jwt`, HS256 verify)
- Gateway injects trusted user context for downstream routing.

3. Internal service trust (Gateway -> Task Service)
- HMAC-signed internal headers:
  - `x-service-name`
  - `x-service-ts`
  - `x-service-signature`
  - `x-forwarded-path`
  - `x-user-id` (when available)
- Task Service verifies signature, caller identity, and timestamp skew.

4. Service-level ownership checks
- Task endpoints use trusted user context when present.
- User mismatch between trusted header and request payload/query is rejected.

5. Outbox consistency
- Task writes domain event to outbox (`events` collection).
- Outbox publisher retries with exponential backoff + jitter.
- Outbox reconciliation job republish support exists.

6. Event security and versioning
- Event envelope includes `version`.
- Shared event signature support added (`signature` HMAC).
- Reminder, Notification, and Analytics verify event signatures (configurable).

7. Retry, DLQ, reconciliation
- Reminder/Notification retry on queue failures.
- Notification dead-letter persistence and DLQ event emission.
- Reconciliation jobs:
  - outbox reconciliation
  - reminder reconciliation
  - DLQ replay reconciliation

8. Worker throttling (consumer-side)
- Reminder task-events worker limiter.
- Reminder due worker limiter.
- Notification send worker limiter.

9. Rate limits
- Gateway IP rate limit.
- Task Service create-task per-user rate limit.

10. Observability + ops integrations
- Prometheus + alert rules.
- Grafana with pre-provisioned Prometheus/Loki datasources and starter dashboard.
- Loki + Promtail centralized container log collection.
- Alertmanager routing to Slack and PagerDuty.

11. Cloud backup sync
- `cloud-sync-service` snapshots all service databases and uploads the JSON bundle to Google Drive.

## Worker Inventory (Current)

1. Task Service
- Outbox publisher loop (`services/task-service/src/workers/outboxPublisher.ts`)
- Role: publish pending outbox events to Redis queue + Pub/Sub.

2. Reminder Service
- `taskEventsWorker` on `task.events.queue`
- `reminderDueWorker` on `reminder.due.queue`
- Role: schedule reminders and trigger notification jobs.

3. Notification Service
- `notificationWorker` on `notification.send.queue`
- Role: send notifications, retry, persist DLQ on terminal failure.

4. Reconciliation Managers (background schedulers)
- Task: outbox reconciliation
- Reminder: reminder reconciliation
- Notification: DLQ replay reconciliation

## Infrastructure Added

- `docker-compose.yml` now includes:
  - Loki
  - Promtail
  - Prometheus
  - Alertmanager
  - Grafana

- Config folders:
  - `infra/monitoring/loki/`
  - `infra/monitoring/promtail/`
  - `infra/monitoring/prometheus/`
  - `infra/monitoring/alertmanager/`
  - `infra/monitoring/grafana/`

## Environment Variables

See root `.env.example` and service `.env.example` files for:
- JWT auth settings
- internal HMAC service trust
- event-bus shared secret
- worker limiter values
- Slack/PagerDuty routing credentials
- Grafana admin credentials
