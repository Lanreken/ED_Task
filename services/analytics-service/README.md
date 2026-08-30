# Analytics Service

Port: `3006`

Consumes domain events and builds reporting projections.

MongoDB database: `ed_analytics_service`

Consumes:

- task events
- reminder events
- notification events
- AI events
- system events

Operational endpoints:

- `GET /metrics`
- `GET /alerts`
- `GET /analytics/summary`
