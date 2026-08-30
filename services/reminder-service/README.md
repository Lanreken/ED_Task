# Reminder Service

Port: `3003`

Owns reminder schedules and delayed reminder jobs.

MongoDB database: `ed_reminder_service`

Consumes:

- `TASK_CREATED`
- `TASK_UPDATED`
- `TASK_COMPLETED`
- `TASK_DELETED`

Publishes:

- `REMINDER_SCHEDULED`
- `REMINDER_TRIGGERED`
- `REMINDER_FAILED`
