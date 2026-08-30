# Event Contracts

## Standard Envelope

Every event uses the same wrapper:

```json
{
  "eventId": "uuid",
  "type": "TASK_CREATED",
  "version": 1,
  "source": "task-service",
  "traceId": "uuid",
  "occurredAt": "2026-05-16T10:00:00.000Z",
  "payload": {}
}
```

## Naming Rules

Use past-tense facts for events:

- good: `TASK_CREATED`
- good: `REMINDER_TRIGGERED`
- good: `NOTIFICATION_FAILED`
- avoid: `CREATE_TASK`
- avoid: `SEND_NOTIFICATION`

Commands ask for work. Events state that something happened.

## Task Events

### `TASK_CREATED` v1

```json
{
  "taskId": "string",
  "userId": "string",
  "title": "string",
  "description": "string | null",
  "priority": 1,
  "dueAt": "ISO_DATE",
  "reminderIntervalMinutes": 30,
  "createdAt": "ISO_DATE"
}
```

### `TASK_UPDATED` v1

```json
{
  "taskId": "string",
  "userId": "string",
  "changedFields": ["title", "dueAt"],
  "updatedAt": "ISO_DATE"
}
```

### `TASK_COMPLETED` v1

```json
{
  "taskId": "string",
  "userId": "string",
  "completedAt": "ISO_DATE"
}
```

## Reminder Events

### `REMINDER_SCHEDULED` v1

```json
{
  "scheduleId": "string",
  "taskId": "string",
  "userId": "string",
  "runAt": "ISO_DATE"
}
```

### `REMINDER_TRIGGERED` v1

```json
{
  "scheduleId": "string",
  "taskId": "string",
  "userId": "string",
  "triggeredAt": "ISO_DATE"
}
```

## Notification Events

### `NOTIFICATION_SENT` v1

```json
{
  "notificationId": "string",
  "taskId": "string",
  "userId": "string",
  "channel": "email",
  "sentAt": "ISO_DATE"
}
```

### `NOTIFICATION_FAILED` v1

```json
{
  "notificationId": "string",
  "taskId": "string",
  "userId": "string",
  "channel": "email",
  "attempt": 3,
  "errorCode": "PROVIDER_TIMEOUT",
  "failedAt": "ISO_DATE"
}
```

## Redis Channels and Queues

Channels:

| Channel | Events |
| --- | --- |
| `task.events` | task domain events |
| `reminder.events` | reminder domain events |
| `notification.events` | notification domain events |
| `ai.events` | AI domain events |
| `system.events` | DLQ, circuit breaker, health events |

Queues:

| Queue | Owner |
| --- | --- |
| `task.outbox.publish` | Task Service |
| `reminder.schedule` | Reminder Service |
| `notification.send` | Notification Service |
| `ai.process` | AI Service |
| `system.dlq` | Shared operational queue |

## Consumer Rule

Every consumer must be idempotent.

Each worker stores processed event IDs:

```txt
processed_events(eventId, processedAt, handlerName)
```

If the same event arrives twice, the worker skips it safely.
