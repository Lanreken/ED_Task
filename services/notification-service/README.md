# Notification Service

Port: `3004`

Owns notification delivery and delivery failure records.

MongoDB database: `ed_notification_service`

Consumes:

- `REMINDER_TRIGGERED`

Publishes:

- `NOTIFICATION_SENT`
- `NOTIFICATION_FAILED`
- `DEAD_LETTER_CREATED`
