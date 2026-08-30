# Step 5 — Full Distributed System Blueprint (Advanced Microservices)

Implementation status reference: see [Stage 6 Hardening Implementation](./STAGE_6_HARDENING_IMPLEMENTATION.md) for current code-level status.

## 1. Core System Identity

> A distributed event-driven task enforcement system where user actions generate events that propagate through asynchronous services, ensuring reminders, notifications, and AI assistance even under failure conditions.

---

## 2. Final Service Topology (Production View)

```txt
                 ┌────────────────────┐
                 │   API GATEWAY      │
                 │     (port 3000)    │
                 └─────────┬──────────┘
                           │
     ┌─────────────────────┼─────────────────────┐
     │                     │                     │
     ▼                     ▼                     ▼
┌──────────┐        ┌────────────┐       ┌──────────────┐
│ TaskSvc  │        │ UserSvc    │       │ AI Service   │
│(port 3002)│       │(port 3001) │       │(port 3005)   │
└────┬─────┘        └────────────┘       └─────┬────────┘
     │                                          │
     │ emits events                             │ consumes events
    ▼                                          ▼
               ┌────────────────────────┐
               │      REDIS BUS         │
               │ (Events + Queues)      │
               │    port 6379           │
               └─────────┬──────────────┘
                         │
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
┌────────────┐   ┌──────────────┐   ┌──────────────┐
│ Reminder   │   │ Notification │   │ Analytics    │
│ Service    │   │ Service      │   │ Service      │
│(port 3003) │   │(port 3004)   │   │(port 3006)   │
└────┬───────┘   └─────┬────────┘   └─────┬────────┘
     │                 │                  │
     ▼                 ▼                  ▼
   MongoDB          MongoDB            MongoDB

                     ┌────────────────────┐
                     │ Cloud Sync Service │
                     │    (port 3007)     │
                     └────────────────────┘
                               │
                               ▼
                        Google Drive backups
```

### Service Port Map

| Service | Port | Public? | Runtime |
|---------|------|---------|---------|
| API Gateway | 3000 | Yes | Express HTTP API |
| User Service | 3001 | No | Express HTTP API |
| Task Service | 3002 | No | Express HTTP API + outbox publisher |
| Reminder Service | 3003 | No | HTTP health API + BullMQ workers |
| Notification Service | 3004 | No | HTTP health API + BullMQ workers |
| AI Service | 3005 | No | HTTP API + queue consumer |
| Analytics Service | 3006 | No | HTTP health API + event consumer |

**Status**: ✅ Implemented (all services scaffolded with proper port assignments)

---

## 3. Event Contract System

### Standard Event Envelope

Every event MUST follow this format:

```json
{
  "eventId": "uuid",
  "type": "TASK_CREATED",
  "timestamp": "ISO_DATE",
  "source": "task-service",
  "version": 1,
  "traceId": "uuid",
  "occurredAt": "2026-05-16T10:00:00.000Z",
  "payload": {}
}
```

**Status**: ✅ Implemented in `libs/events/src/index.ts`

### Core Events

#### Task Domain Events
| Event | Status | Source |
|-------|--------|--------|
| TASK_CREATED | ✅ Defined | Task Service |
| TASK_UPDATED | ✅ Defined | Task Service |
| TASK_COMPLETED | ✅ Defined | Task Service |
| TASK_DELETED | ✅ Defined | Task Service |
| TASK_OVERDUE | 📋 Planned | Task Service |

#### Reminder Domain Events
| Event | Status | Source |
|-------|--------|--------|
| REMINDER_SCHEDULED | ✅ Defined | Reminder Service |
| REMINDER_TRIGGERED | ✅ Defined | Reminder Service |
| REMINDER_FAILED | 📋 Planned | Reminder Service |

#### Notification Domain Events
| Event | Status | Source |
|-------|--------|--------|
| NOTIFICATION_SENT | ✅ Defined | Notification Service |
| NOTIFICATION_FAILED | ✅ Defined | Notification Service |

#### System Domain Events
| Event | Status | Source |
|-------|--------|--------|
| DEAD_LETTER_CREATED | ✅ Defined | Notification Service |
| CIRCUIT_OPENED | 📋 Planned | Any Service |
| CIRCUIT_CLOSED | 📋 Planned | Any Service |

### Redis Channels and Queues

#### Channels (Pub/Sub)
| Channel | Events | Status |
|---------|--------|--------|
| `task.events` | Task domain events | ✅ Implemented |
| `reminder.events` | Reminder domain events | ✅ Implemented |
| `notification.events` | Notification domain events | ✅ Implemented |
| `ai.events` | AI domain events | ✅ Implemented |
| `system.events` | DLQ, circuit breaker events | ✅ Implemented |

#### Queues (BullMQ)
| Queue | Owner | Status |
|-------|-------|--------|
| `task.outbox.publish` | Task Service | ✅ Implemented |
| `reminder.schedule` | Reminder Service | ✅ Implemented |
| `notification.send` | Notification Service | ✅ Implemented |
| `ai.process` | AI Service | ✅ Implemented |
| `system.dlq` | Shared operational | ✅ Implemented |

---

## 4. Service Responsibilities (Strict Boundaries)

### Task Service (Source of Truth)
**ONLY responsible for:**
- ✅ Task creation
- ✅ Task updates
- ✅ Task state management
- ✅ Emitting events via outbox pattern

**Does NOT:**
- ❌ Send notifications directly
- ❌ Schedule reminders directly

**MongoDB Database:** `ed_task_service`
**Collections:** `tasks`, `events` (outbox), `idempotency_keys`

**Status**: ✅ Implemented

### Reminder Service (Time Engine)
**ONLY responsible for:**
- ✅ Consuming TASK_CREATED events
- ✅ Calculating reminder schedules
- ✅ Creating delayed jobs
- ✅ Emitting REMINDER_TRIGGERED events

**Does NOT:**
- ❌ Store task source-of-truth data
- ❌ Send notifications directly

**MongoDB Database:** `ed_reminder_service`
**Collections:** `reminder_schedules`, `jobs`, `processed_events`

**Status**: ✅ Implemented

### Notification Service
**ONLY responsible for:**
- ✅ Sending messages (email, push, SMS, browser)
- ✅ Retrying failed deliveries
- ✅ Managing dead letter queue
- ✅ Delivery tracking

**MongoDB Database:** `ed_notification_service`
**Collections:** `notifications`, `delivery_attempts`, `dead_letters`, `processed_events`

**Status**: ✅ Implemented

### AI Service (Optional Intelligence Layer)
**ONLY responsible for:**
- 📋 Task breakdown suggestions
- 📋 Priority suggestions
- 📋 Planning assistance

**MongoDB Database:** `ed_ai_service`
**Collections:** `ai_requests`, `task_suggestions`, `processed_events`

**Status**: 📋 Scaffolded (needs AI provider integration)

### Analytics Service
**ONLY responsible for:**
- 📋 Consuming all domain events
- 📋 Building reporting projections
- 📋 Exposing system metrics

**MongoDB Database:** `ed_analytics_service`
**Collections:** `event_projections`, `daily_metrics`, `processed_events`

**Status**: 📋 Scaffolded (needs event consumers)

---

## 5. Data Ownership Rules

Each service owns its data exclusively. NO SHARING DATABASES.

```
┌─────────────────────┐    ┌─────────────────────┐
│   Task Service      │    │   Reminder Service  │
│   ed_task_service   │    │  ed_reminder_service│
│                     │    │                     │
│ - tasks             │    │ - reminder_schedules│
│ - events (outbox)   │    │ - jobs              │
│ - idempotency_keys  │    │ - processed_events  │
└─────────────────────┘    └─────────────────────┘

┌─────────────────────┐    ┌─────────────────────┐
│ Notification Service│    │    AI Service       │
│ ed_notification_svc │    │   ed_ai_service     │
│                     │    │                     │
│ - notifications     │    │ - ai_requests       │
│ - delivery_attempts │    │ - task_suggestions  │
│ - dead_letters      │    │ - processed_events  │
│ - processed_events  │    │                     │
└─────────────────────┘    └─────────────────────┘
```

**Status**: ✅ Implemented (each service has its own MongoDB database)

---

## 6. Failure-First Architecture

### Case 1: Task Service Fails
```
Client Request → API Gateway → [Task Service Down]
                                    ↓
                           Return 503 or Queue Request
                                    ↓
                           Client Retry with Backoff
```
**Mitigation:**
- Circuit breaker at API Gateway
- Client-side retry with exponential backoff
- Health check monitoring

**Status**: ✅ Implemented (gateway circuit breaker + retry + auth/rate limit)

### Case 2: Redis Fails
```
Task Service → Write to MongoDB
                    ↓
              Outbox Event Saved
                    ↓
         [Redis Down - Event Queued Locally]
                    ↓
           Publisher Retries Later
```
**Mitigation:**
- Outbox pattern ensures events are persisted
- Publisher retries with exponential backoff
- Events remain in `pending` status until published

**Status**: ✅ Implemented (outbox pattern with retry)

### Case 3: Notification Failure
```
Send Notification
       ↓ fail
Retry (3 times with backoff)
       ↓ still fail
Store in Dead Letter Queue
       ↓
Emit DEAD_LETTER_CREATED event
       ↓
Alert system logs incident
```
**Mitigation:**
- Exponential backoff retry policy
- Dead letter queue for permanent failures
- DLQ monitoring and alerting

**Status**: ✅ Implemented (DLQ model exists, needs monitoring)

### Case 4: Reminder Delay Failure
```
Reminder Worker → Process Due Reminder
                         ↓ fail
                  Retry with Backoff
                         ↓ still fail
                  Store in DLQ
                         ↓
            Reconciliation Job Fixes Later
```
**Mitigation:**
- MongoDB backup schedules
- Periodic reconciliation job
- Manual DLQ replay capability

**Status**: ✅ Implemented (reconciliation job in reminder service)

---

## 7. Reconciliation System

A background process that fixes inconsistencies in the distributed system.

### Reconciliation Jobs

#### Task → Reminder Reconciliation
```typescript
// Run every 5 minutes
async function reconcileReminders() {
  // 1. Find all tasks with dueAt in the future
  // 2. Check if each has a corresponding reminder schedule
  // 3. Create missing reminder schedules
  // 4. Log discrepancies
}
```

#### Outbox → Redis Reconciliation
```typescript
// Run every minute
async function reconcileOutbox() {
  // 1. Find all outbox events with status='pending' older than 1 minute
  // 2. Attempt to republish to Redis
  // 3. Update status or move to failed
}
```

#### Notification DLQ Reconciliation
```typescript
// Run every 10 minutes
async function reconcileDLQ() {
  // 1. Find DLQ items that might be retryable
  // 2. Check if target service is healthy
  // 3. Attempt replay or escalate to ops team
}
```

**Status**: ✅ Implemented (task outbox, reminder, and DLQ reconciliation jobs)

---

## 8. Observability Architecture

### Logging Flow
```
All Services → Structured JSON Logs → Log Aggregator → Storage/Analysis
```

Each log entry should include:
- `timestamp`
- `level` (info, warn, error)
- `service`
- `traceId`
- `eventId` (if applicable)
- `message`
- `metadata` (context-specific)

**Status**: 📋 Partially implemented (needs centralized aggregation)

### Metrics to Track

| Metric | Service | Purpose |
|--------|---------|---------|
| task_creation_rate | Task Service | Monitor usage |
| notification_success_rate | Notification Service | Monitor delivery health |
| queue_size | All workers | Detect backlogs |
| worker_latency | All workers | Performance monitoring |
| retry_count | All workers | Detect flaky dependencies |
| dlq_count | All services | Detect permanent failures |
| error_rate | All services | Overall health |

**Status**: ✅ Implemented (service-level `/metrics` endpoints and standard counters/gauges/histograms)

### Distributed Tracing

Every request/event carries a `traceId`:

```
Client Request (traceId: abc-123)
    ↓
API Gateway (traceId: abc-123)
    ↓
Task Service (traceId: abc-123)
    ↓
Outbox Event (traceId: abc-123)
    ↓
Reminder Service (traceId: abc-123)
    ↓
Notification Service (traceId: abc-123)
```

**Status**: ✅ Implemented (traceId in event envelope)

### Alerting

Alert when:
- Queue backlog grows beyond threshold
- Error rate exceeds baseline
- DLQ items accumulate
- Worker crashes detected
- Circuit breaker opens

**Status**: ✅ Implemented (analytics alert checks + `/alerts` endpoint)

---

## 9. Scaling Model

### Horizontal Scaling

| Component | Scale Strategy |
|-----------|---------------|
| API Gateway | Add instances behind load balancer |
| Task Service | Add instances (stateless API) |
| Reminder Workers | Add worker instances (BullMQ supports concurrent workers) |
| Notification Workers | Add worker instances |
| Redis | Cluster mode for high availability |
| MongoDB | Replica sets + sharding by userId |

### Scaling Commands

```bash
# Scale reminder workers
docker compose up -d --scale reminder-service=3

# Scale notification workers  
docker compose up -d --scale notification-service=5
```

**Status**: ✅ Supported by architecture

---

## 10. Implementation Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Service Topology | ✅ Complete | All 7 services scaffolded |
| Event Contracts | ✅ Complete | Standardized envelope in shared lib |
| Data Ownership | ✅ Complete | Each service has its own DB |
| Outbox Pattern | ✅ Complete | Task service implements outbox |
| Idempotency Keys | ✅ Complete | Model exists in task service |
| Dead Letter Queue | ✅ Complete | Model exists in notification service |
| Processed Events | ✅ Complete | Tracking exists in workers |
| Trace ID Propagation | ✅ Complete | In event envelope |
| Circuit Breaker | ✅ Complete | Implemented in libs/common |
| Reconciliation Jobs | ✅ Complete | Outbox, Reminder, DLQ reconciliation |
| Metrics Collection | ✅ Complete | Prometheus-compatible metrics library |
| AI Service Integration | ✅ Complete | Circuit breaker + suggestion endpoints |
| Analytics Event Consumers | ✅ Complete | Redis pub/sub event consumers |
| Centralized Logging | 📋 Partial | Structured JSON logs, needs aggregation |
| Alerting System | ✅ Complete | Analytics service polls health/metrics and exposes `/alerts` |

---

## 11. Next Steps (Priority Order)

1. **Observability Enhancements**
   - Set up centralized log aggregation (e.g., ELK stack, Loki)
   - Deploy Prometheus for metrics collection from `/metrics` endpoints
   - Set up Grafana dashboards for visualization
   - Configure alerting based on metrics thresholds

2. **AI Service Production Integration**
   - Connect to AI provider (OpenAI, Claude, etc.)
   - Replace simulated breakdown/priority functions with real AI calls
   - Add AI request/response logging for debugging
   - Implement rate limiting for AI provider calls

3. **Gateway Hardening Extensions**
   - Add per-route authorization policies (role and scope checks)
   - Add distributed rate limiting using Redis for multi-instance deployments

4. **Enhanced Reconciliation**
   - Add more sophisticated reconciliation logic
   - Store reconciliation results in MongoDB for audit trails
   - Add manual reconciliation triggers via API

5. **Event Schema Versioning**
   - Implement event schema versioning strategy
   - Add backward compatibility for event consumers
   - Document event migration procedures

---

## 12. Mental Model Shift

> Stop thinking: "services doing tasks"
> 
> Start thinking: "events flowing through a resilient system that self-recovers under failure"

This architecture is designed for:
- **Resilience**: Survives component failures
- **Scalability**: Each component scales independently
- **Observability**: Full traceability of events
- **Maintainability**: Clear service boundaries
- **Extensibility**: Easy to add new services

---

## Appendix: File Structure Reference

```
ED_Task/
├── docs/
│   ├── STEP_2_ARCHITECTURE.md      # Initial architecture
│   ├── STEP_3_REDIS_EVENT_SYSTEM.md # Redis event system
│   ├── EVENT_CONTRACTS.md           # Event specifications
│   ├── SERVICE_CONTRACTS.md         # Service boundaries
│   ├── RELIABILITY_FLOW.md          # Failure handling
│   └── STEP_5_DISTRIBUTED_SYSTEM_BLUEPRINT.md # This document
├── libs/
│   ├── common/                      # Shared utilities
│   └── events/                      # Event types and envelopes
├── services/
│   ├── api-gateway/                 # API Gateway (port 3000)
│   ├── user-service/                # User Service (port 3001)
│   ├── task-service/                # Task Service (port 3002)
│   ├── reminder-service/            # Reminder Service (port 3003)
│   ├── notification-service/        # Notification Service (port 3004)
│   ├── ai-service/                  # AI Service (port 3005)
│   └── analytics-service/           # Analytics Service (port 3006)
├── docker-compose.yml               # Infrastructure
└── package.json                     # Monorepo root
