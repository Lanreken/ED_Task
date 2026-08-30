# Reliability Flow

## Reliability Goals

The system should survive:

- duplicate client requests
- Redis downtime
- worker crashes
- MongoDB temporary failures
- malformed events
- notification provider failures

## Outbox Pattern

The Task Service does not publish directly to Redis during the request.

It writes the task and event in one MongoDB transaction:

```txt
Create task
  -> write tasks document
  -> write events/outbox document
  -> commit
```

A separate publisher later sends pending outbox events to Redis.

This prevents the dangerous case:

```txt
task saved
event lost
```

## Idempotency

Task creation supports an `Idempotency-Key` header.

If the same user retries the same request with the same key:

- return the original response
- do not create another task
- do not publish another event

## Retry Policy

Use exponential backoff with jitter:

```txt
1s -> 2s -> 4s -> 8s -> 16s + random jitter
```

Retry only errors that can recover:

- network timeout
- provider unavailable
- Redis connection failure
- temporary MongoDB failure

Do not retry permanent validation failures.

## Dead Letter Queue

After max attempts, move failed work to DLQ.

DLQ records must include:

- original event ID
- payload
- service name
- queue name
- retry history
- final error

## Circuit Breaker

Use a circuit breaker for external dependencies:

- notification provider
- AI provider
- external email API

States:

```txt
CLOSED -> normal
OPEN -> calls blocked temporarily
HALF_OPEN -> test if dependency recovered
```

## Reconciliation Jobs

Periodic reconciliation protects against missed work.

Examples:

- Reminder Service scans for tasks that should have reminders but do not.
- Notification Service scans stuck pending notifications.
- Outbox Publisher scans old pending outbox events.

## Observability

Each service should emit:

- structured logs
- request count
- error count
- queue size
- retry count
- DLQ count
- latency

Every request/event should carry a `traceId`.
