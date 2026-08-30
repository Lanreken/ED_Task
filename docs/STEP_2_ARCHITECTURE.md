# Step 2 Architecture

## System Identity

This is a distributed task and reminder system using event-driven microservices.

The system is not only a todo API. The real flow is:

```txt
User action
  -> API Gateway
  -> Domain Service
  -> MongoDB write
  -> Outbox event
  -> Redis event/queue
  -> Worker services
  -> Retry/DLQ/observability
```

## Core Rule

Each microservice has:

- its own port
- its own MongoDB database or owned collections
- its own responsibility
- its own logs and health checks
- no direct writes to another service's database

Services communicate through:

- HTTP through the API Gateway for request/response actions
- Redis events and queues for asynchronous work

## Topology

```txt
Frontend / Mobile
       |
       v
API Gateway :3000
       |
       +--> User Service :3001
       +--> Task Service :3002
       +--> AI Service :3005
                |
                v
          MongoDB Atlas / Local MongoDB
                |
                v
Task Service Outbox Publisher
                |
                v
Redis Event Bus + BullMQ Queues
       |
       +--> Reminder Service :3003
       +--> Notification Service :3004
       +--> Analytics Service :3006
```

## Service Discovery

For local development, service discovery is simple static ports:

- `api-gateway:3000`
- `task-service:3002`
- `reminder-service:3003`

In production, service discovery becomes one of:

- Kubernetes DNS
- Consul
- Eureka
- cloud load balancer service names

Do not add Consul/Eureka yet. Learn the service boundaries first.

## Data Ownership

| Service | Owns | Does Not Own |
| --- | --- | --- |
| User Service | users, sessions, preferences, user audit logs | tasks, reminders |
| Task Service | tasks, events/outbox, idempotency keys, task audit logs | notifications |
| Reminder Service | schedules, reminder jobs, processed events | task source-of-truth state |
| Notification Service | notifications, delivery jobs, DLQ, processed events | task state |
| AI Service | AI requests, AI jobs, suggestions | task lifecycle |
| Analytics Service | event projections and reports | source-of-truth data |

## Request Flow

Create task:

```txt
POST /tasks
  -> API Gateway validates auth and request size
  -> Task Service validates task input
  -> Task Service writes task to MongoDB
  -> Task Service writes TASK_CREATED to outbox
  -> Outbox publisher sends event to Redis
  -> Reminder Service consumes event
  -> Reminder Service schedules delayed reminder job
```

## Reminder Flow

```txt
TASK_CREATED event
  -> Reminder Service calculates reminder time
  -> Reminder job added to Redis delayed queue
  -> Worker wakes at due time
  -> Worker emits REMINDER_TRIGGERED
  -> Notification Service sends notification
  -> Notification result saved
```

## Failure Flow

```txt
Notification send fails
  -> retry with exponential backoff
  -> retry count reaches max
  -> record moves to dead letter queue
  -> DEAD_LETTER_CREATED event emitted
  -> logs/metrics/traces capture failure
```

## Advanced Components, Added Gradually

The full advanced backend includes:

- service discovery
- centralized logging
- tracing
- metrics
- authentication
- authorization
- rate limiting
- circuit breakers
- retries with jitter
- dead letter queues
- caching
- orchestration

For this project, add them in stages. Do not build all of them on day one.
