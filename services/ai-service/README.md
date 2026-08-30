# AI Service

Port: `3005`

Owns AI-generated suggestions, task breakdowns, and prioritization outputs.

MongoDB database: `ed_ai_service`

Consumes:

- `TASK_CREATED`
- `USER_REQUESTED_AI_HELP`

Publishes:

- `AI_TASK_BREAKDOWN_CREATED`
- `AI_TASK_PRIORITY_SUGGESTED`
