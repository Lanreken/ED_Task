import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const EventTypes = {
  TaskCreated: 'TASK_CREATED',
  TaskUpdated: 'TASK_UPDATED',
  TaskCompleted: 'TASK_COMPLETED',
  TaskDeleted: 'TASK_DELETED',
  TaskOverdue: 'TASK_OVERDUE',
  ReminderScheduled: 'REMINDER_SCHEDULED',
  ReminderTriggered: 'REMINDER_TRIGGERED',
  ReminderFailed: 'REMINDER_FAILED',
  NotificationSent: 'NOTIFICATION_SENT',
  NotificationFailed: 'NOTIFICATION_FAILED',
  DeadLetterCreated: 'DEAD_LETTER_CREATED',
  CircuitOpened: 'CIRCUIT_OPENED',
  CircuitClosed: 'CIRCUIT_CLOSED',
} as const;

export const RedisChannels = {
  TaskEvents: 'task.events',
  ReminderEvents: 'reminder.events',
  NotificationEvents: 'notification.events',
  AiEvents: 'ai.events',
  SystemEvents: 'system.events',
} as const;

export const QueueNames = {
  TaskEvents: 'task.events.queue',
  ReminderDue: 'reminder.due.queue',
  NotificationSend: 'notification.send.queue',
  AiProcess: 'ai.process.queue',
  SystemDlq: 'system.dlq.queue',
} as const;

export const JobNames = {
  PublishTaskEvent: 'publish-task-event',
  ScheduleReminder: 'schedule-reminder',
  TriggerReminder: 'trigger-reminder',
  SendNotification: 'send-notification',
  ProcessAi: 'process-ai',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

export type EventEnvelope<TPayload = Record<string, unknown>> = {
  eventId: string;
  type: EventType;
  version: number;
  source: string;
  traceId: string;
  occurredAt: string;
  payload: TPayload;
  signature?: string;
};

export type TaskCreatedPayload = {
  taskId: string;
  userId: string;
  title: string;
  description?: string | null;
  priority: number;
  dueAt: string;
  reminderIntervalMinutes: number;
  createdAt: string;
};

export type TaskCompletedPayload = {
  taskId: string;
  userId: string;
  completedAt: string;
};

export type ReminderTriggeredPayload = {
  scheduleId: string;
  taskId: string;
  userId: string;
  title: string;
  dueAt: string;
  triggeredAt: string;
};

export type NotificationPayload = {
  notificationId?: string;
  taskId: string;
  userId: string;
  title: string;
  message: string;
  channel: 'email' | 'push' | 'sms' | 'browser';
};

export function createEventEnvelope<TPayload>(input: {
  type: EventType;
  source: string;
  traceId?: string;
  payload: TPayload;
  version?: number;
  occurredAt?: string;
}): EventEnvelope<TPayload> {
  return {
    eventId: randomUUID(),
    type: input.type,
    version: input.version ?? 1,
    source: input.source,
    traceId: input.traceId ?? randomUUID(),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    payload: input.payload,
  };
}

function canonicalEventPayload<TPayload>(event: EventEnvelope<TPayload>) {
  return JSON.stringify({
    eventId: event.eventId,
    type: event.type,
    version: event.version,
    source: event.source,
    traceId: event.traceId,
    occurredAt: event.occurredAt,
    payload: event.payload,
  });
}

export function signEventEnvelope<TPayload>(event: EventEnvelope<TPayload>, sharedSecret: string) {
  return createHmac('sha256', sharedSecret)
    .update(canonicalEventPayload(event))
    .digest('hex');
}

export function attachEventSignature<TPayload>(event: EventEnvelope<TPayload>, sharedSecret: string) {
  return {
    ...event,
    signature: signEventEnvelope(event, sharedSecret),
  };
}

export function verifyEventEnvelopeSignature<TPayload>(event: EventEnvelope<TPayload>, sharedSecret: string) {
  if (!event.signature) {
    return false;
  }

  const expected = signEventEnvelope(
    {
      ...event,
      signature: undefined,
    },
    sharedSecret,
  );
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(event.signature, 'hex');

  if (expectedBuffer.length === 0 || expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
