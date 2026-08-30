# MongoDB Models

## Step 2 Goal

This document defines the database schema for the event-driven task reminder system.

The rule is simple:

```txt
One MongoDB Atlas cluster is acceptable.
Each microservice still owns its own database and collections.
No service writes directly to another service's collections.
```

## Logical Databases

Use one Atlas cluster locally or in production, but split data by service:

```txt
ed_user_service
ed_task_service
ed_reminder_service
ed_notification_service
ed_ai_service
ed_analytics_service
```

This gives you microservice ownership without needing many MongoDB clusters.

## Core Data Models

The system has these main data groups:

| Model | Owner |
| --- | --- |
| Users | User Service |
| Tasks | Task Service |
| Events / Outbox | Producing service |
| Notifications | Notification Service |
| Jobs / Queue Tracking | Worker-owning service |
| Dead Letters | Service that failed the job |
| Audit Logs | Service where the action happened |

## User Service

Database: `ed_user_service`

### `users`

```js
{
  _id: ObjectId,
  name: String,
  email: String,
  passwordHash: String,
  preferences: {
    reminderFrequency: "aggressive" | "normal" | "soft",
    notificationEnabled: Boolean,
    aiEnabled: Boolean
  },
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- unique `{ email: 1 }`
- `{ createdAt: -1 }`

### `audit_logs`

```js
{
  _id: ObjectId,
  userId: ObjectId,
  action: String,
  entityId: ObjectId,
  entityType: String,
  ipAddress: String,
  traceId: String,
  createdAt: Date
}
```

Indexes:

- `{ userId: 1, createdAt: -1 }`
- `{ entityType: 1, entityId: 1 }`

## Task Service

Database: `ed_task_service`

### `tasks`

```js
{
  _id: ObjectId,
  userId: ObjectId,
  title: String,
  description: String,
  status: "pending" | "in_progress" | "completed" | "overdue" | "deleted",
  priority: Number,
  schedule: {
    startAt: Date,
    dueAt: Date,
    reminderIntervalMinutes: Number
  },
  metadata: {
    tags: [String],
    aiBreakdownGenerated: Boolean
  },
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- `{ userId: 1, status: 1 }`
- `{ "schedule.dueAt": 1 }`
- `{ userId: 1, createdAt: -1 }`

### `events`

This is the Task Service event log. It records task domain events before publishing.

```js
{
  _id: ObjectId,
  eventId: String,
  type: "TASK_CREATED" | "TASK_UPDATED" | "TASK_COMPLETED" | "TASK_DELETED" | "TASK_OVERDUE",
  version: Number,
  sourceService: "task-service",
  aggregateType: "task",
  aggregateId: ObjectId,
  traceId: String,
  payload: Object,
  status: "pending" | "published" | "failed",
  retryCount: Number,
  nextAttemptAt: Date,
  lastError: String,
  createdAt: Date,
  processedAt: Date
}
```

Indexes:

- unique `{ eventId: 1 }`
- `{ type: 1, status: 1 }`
- `{ status: 1, nextAttemptAt: 1 }`
- `{ aggregateId: 1, createdAt: 1 }`

Note: this collection is also the outbox for the Task Service. In this codebase, the MongoDB collection name is `events`.

### `idempotency_keys`

```js
{
  _id: ObjectId,
  key: String,
  userId: ObjectId,
  requestHash: String,
  response: Object,
  createdAt: Date,
  expiresAt: Date
}
```

Indexes:

- unique `{ userId: 1, key: 1 }`
- TTL `{ expiresAt: 1 }`

### `audit_logs`

```js
{
  _id: ObjectId,
  userId: ObjectId,
  action: "TASK_CREATED" | "TASK_UPDATED" | "TASK_COMPLETED" | "TASK_DELETED",
  entityId: ObjectId,
  entityType: "task",
  ipAddress: String,
  traceId: String,
  createdAt: Date
}
```

Indexes:

- `{ userId: 1, createdAt: -1 }`
- `{ entityId: 1, createdAt: -1 }`

## Reminder Service

Database: `ed_reminder_service`

### `reminder_schedules`

```js
{
  _id: ObjectId,
  taskId: ObjectId,
  userId: ObjectId,
  status: "scheduled" | "triggered" | "cancelled" | "failed",
  runAt: Date,
  sourceEventId: String,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- `{ taskId: 1 }`
- `{ status: 1, runAt: 1 }`
- unique `{ sourceEventId: 1 }`

### `jobs`

This tracks Redis/BullMQ jobs in MongoDB for recovery and history.

```js
{
  _id: ObjectId,
  type: "task_reminder",
  status: "queued" | "processing" | "completed" | "failed",
  payload: Object,
  attempts: Number,
  runAt: Date,
  queueJobId: String,
  lastError: String,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- `{ status: 1, runAt: 1 }`
- `{ type: 1, status: 1 }`
- `{ queueJobId: 1 }`

### `processed_events`

```js
{
  _id: ObjectId,
  eventId: String,
  handlerName: String,
  processedAt: Date
}
```

Indexes:

- unique `{ eventId: 1, handlerName: 1 }`

## Notification Service

Database: `ed_notification_service`

### `notifications`

```js
{
  _id: ObjectId,
  userId: ObjectId,
  taskId: ObjectId,
  type: "push" | "email" | "sms" | "browser",
  message: String,
  status: "pending" | "sent" | "failed",
  sentAt: Date,
  retryCount: Number,
  providerResponse: Object,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- `{ userId: 1, createdAt: -1 }`
- `{ status: 1, createdAt: 1 }`
- `{ taskId: 1 }`

### `jobs`

```js
{
  _id: ObjectId,
  type: "send_notification",
  status: "queued" | "processing" | "completed" | "failed",
  payload: Object,
  attempts: Number,
  runAt: Date,
  queueJobId: String,
  lastError: String,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- `{ status: 1, runAt: 1 }`
- `{ type: 1, status: 1 }`

### `dead_letters`

```js
{
  _id: ObjectId,
  originalEventId: String,
  originalType: String,
  payload: Object,
  error: {
    message: String,
    code: String,
    stack: String
  },
  service: "notification-service",
  queue: String,
  retryHistory: [
    {
      attempt: Number,
      error: String,
      timestamp: Date
    }
  ],
  createdAt: Date
}
```

Indexes:

- `{ service: 1, createdAt: -1 }`
- `{ originalEventId: 1 }`
- `{ originalType: 1 }`

### `processed_events`

```js
{
  _id: ObjectId,
  eventId: String,
  handlerName: String,
  processedAt: Date
}
```

Indexes:

- unique `{ eventId: 1, handlerName: 1 }`

## AI Service

Database: `ed_ai_service`

### `ai_requests`

```js
{
  _id: ObjectId,
  userId: ObjectId,
  taskId: ObjectId,
  type: "task_breakdown" | "priority_ranking",
  status: "queued" | "processing" | "completed" | "failed",
  input: Object,
  output: Object,
  error: String,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- `{ userId: 1, createdAt: -1 }`
- `{ status: 1, createdAt: 1 }`

### `jobs`

```js
{
  _id: ObjectId,
  type: "ai_processing",
  status: "queued" | "processing" | "completed" | "failed",
  payload: Object,
  attempts: Number,
  runAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- `{ status: 1, runAt: 1 }`

## Analytics Service

Database: `ed_analytics_service`

### `event_projections`

```js
{
  _id: ObjectId,
  eventId: String,
  type: String,
  sourceService: String,
  payload: Object,
  createdAt: Date
}
```

Indexes:

- unique `{ eventId: 1 }`
- `{ type: 1, createdAt: -1 }`
- `{ sourceService: 1, createdAt: -1 }`

## Data Flow

### Create Task

```txt
User
  -> API Gateway
  -> Task Service
  -> tasks collection
  -> events collection
  -> Redis event bus later
```

### Reminder

```txt
TASK_CREATED event
  -> Reminder Service
  -> reminder_schedules collection
  -> jobs collection
  -> Redis delayed queue later
```

### Notification Failure

```txt
Notification fails
  -> retry attempts
  -> notifications status updated
  -> jobs status updated
  -> dead_letters if retries are exhausted
```

## Final Rule

Each service only writes to its own database:

```txt
User Service         -> ed_user_service
Task Service         -> ed_task_service
Reminder Service     -> ed_reminder_service
Notification Service -> ed_notification_service
AI Service           -> ed_ai_service
Analytics Service    -> ed_analytics_service
```
