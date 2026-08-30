# Step 3 Redis Event System

Redis is the runtime communication layer for the microservices.

In this project Redis is used for three things:

1. Pub/Sub channels for live events.
2. BullMQ queues for durable background work.
3. BullMQ delayed jobs for scheduled reminders.

## Runtime Flow

```txt
POST /tasks
  -> API Gateway :3000
  -> Task Service :3002
  -> MongoDB ed_task_service.tasks
  -> MongoDB ed_task_service.events
  -> Task Outbox Publisher
  -> Redis task.events channel
  -> Redis task.events.queue
  -> Reminder Service :3003
  -> Redis reminder.due.queue delayed job
  -> Notification Service :3004
```

## Redis Channels

Channels are useful for live broadcasting and debugging.

| Channel | Publisher | Consumers |
| --- | --- | --- |
| `task.events` | Task Service outbox publisher | Reminder, AI, Analytics |
| `reminder.events` | Reminder Service | Notification, Analytics |
| `notification.events` | Notification Service | Analytics |
| `system.events` | Any service | Monitoring/Analytics |

Pub/Sub is not enough by itself because subscribers can miss messages while offline.

## BullMQ Queues

Queues are the durable work path.

| Queue | Producer | Consumer |
| --- | --- | --- |
| `task.events.queue` | Task Service outbox publisher | Reminder Service |
| `reminder.due.queue` | Reminder Service | Reminder Service delayed worker |
| `notification.send.queue` | Reminder Service | Notification Service |
| `ai.process.queue` | Task/API layer later | AI Service |
| `system.dlq.queue` | Any service later | DLQ tooling later |

## Why Both Pub/Sub and Queues?

Pub/Sub is fast but not durable.

Queues are durable and retryable.

So the system uses both:

```txt
Task event published
  -> Redis Pub/Sub for live listeners
  -> BullMQ queue for reliable workers
```

## Delayed Reminder Jobs

When `TASK_CREATED` reaches Reminder Service:

```txt
dueAt - reminderIntervalMinutes = runAt
```

Then BullMQ receives a delayed job:

```js
{
  name: "trigger-reminder",
  data: {
    scheduleId,
    reminderEvent
  },
  delay,
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000
  }
}
```

## Failure Flow

```txt
Worker fails
  -> BullMQ retries with exponential backoff
  -> attempts exhausted
  -> service writes dead_letters record
  -> service publishes DEAD_LETTER_CREATED
```

## Current Code Path

Implemented services:

- API Gateway on `3000`
- Task Service on `3002`
- Task Outbox Publisher
- Reminder Service on `3003`
- Notification Service on `3004`
- health-only User, AI, and Analytics services

Run the core flow with:

```bash
npm run infra:up
npm run dev:core
```

Then create a task through the gateway:

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
