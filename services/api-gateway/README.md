# API Gateway

Port: `3000`

Public entry point for frontend/mobile clients.

Responsibilities:

- authenticate requests
- authorize user actions
- rate limit clients
- apply downstream circuit breaker and retries
- validate request size and basic payload shape
- attach `traceId`
- route traffic to internal services

Operational endpoints:

- `GET /metrics`
- `GET /circuit-breakers`

Routes later:

- `POST /auth/register` -> User Service
- `POST /auth/login` -> User Service
- `POST /tasks` -> Task Service
- `GET /tasks` -> Task Service
- `POST /ai/tasks/:id/breakdown` -> AI Service
